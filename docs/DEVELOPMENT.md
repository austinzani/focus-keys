# Development

The plugin lives in `com.austinzani.focus-keys.sdPlugin/`. TypeScript in `src/` is bundled by rollup into `bin/plugin.js`. It uses `@elgato/streamdeck` v3 on Node.js 24. The UUID is final once published; see [Renaming before first publish](#renaming-before-first-publish).

User-facing behavior is described in [USER_GUIDE.md](USER_GUIDE.md). This file covers how it's built and why.

## Prerequisites

- macOS 12 or later with Stream Deck 7.1 or later
- Node.js 24 or later and npm
- The Elgato CLI is a dev dependency. Run it as `npx streamdeck`; don't install it globally.

## Build and run

```sh
npm install
npm run build        # bundles src/ into com.austinzani.focus-keys.sdPlugin/bin/plugin.js
npx streamdeck dev   # once per machine: enables Stream Deck developer mode
npm run link         # symlinks the .sdPlugin folder into Stream Deck's Plugins folder
npm run restart      # reloads the plugin after each build
npm run watch        # optional: rebuild (with sourcemaps) and restart on every change
```

## Checks

```sh
npm test             # vitest behavior tests, driven by a controlled clock
npm run typecheck
npm run validate     # streamdeck validate on the .sdPlugin folder
npm run preview      # PNG contact sheets of every font, state and sample color in ./preview (git-ignored)
npm run glyphs       # regenerates src/render/glyphs.generated.ts and the font licenses; commit the output
npm run icons        # regenerates the plugin's PNG icons and Marketplace gallery renders
npm run package      # build, validate and pack (see Packaging)
```

`npm run preview -- <dir>` writes the sheets elsewhere. They're rendered by resvg at 72 px and 144 px (the SDK's 1x and @2x key sizes) and at 96 px (the Neo's physical key panel, per the python-elgato-streamdeck device table; Elgato's docs don't state a Neo size). resvg stands in for Stream Deck's rasterizer, so the sheets don't replace a check on the Neo.

## Debugging

- Linked dev build logs: `com.austinzani.focus-keys.sdPlugin/logs/`. Installed package logs: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.austinzani.focus-keys.sdPlugin/logs/`. Stream Deck's log: `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`.
- To attach a Node debugger, temporarily add `"Debug": "enabled"` (or `"break"` to stop on the first line) under `Nodejs` in `manifest.json`, then `npm run build && npm run restart`. Stream Deck picks a port and only applies it in developer mode. Don't commit it: `npm run package` refuses to pack a manifest with `Nodejs.Debug`.
- `npm run watch` builds with sourcemaps. A plain `npm run build` is minified by terser with no sourcemaps.

## Layout

- `src/core/coordinator.ts`: timer logic with no SDK imports. Takes key appearances, settings changes, key down/up and clock ticks; returns the image each key should show and session transition events. A running session stores an absolute end time; a paused one stores its frozen remaining time. `HOLD_MS` (600), `DEFAULT_DURATION_MINUTES` (5), `MAX_DURATION_MINUTES` (180).
- `src/core/key-style.ts`: validates each key's color and font; lightens colors below 4.5:1 contrast on `#111111`.
- `src/render/key-image.ts`: draws a key as SVG. Digits are path outlines from `src/render/glyphs.generated.ts`, so the look doesn't depend on installed fonts.
  A paused key dims its number to `#a3a3a3` and mixes the ring 60% toward `#5a5a5a`. With a grey key color the muted ring looks almost the same as the running one, so paused and running differ mainly by the dimmed number.
- `src/core/alerts.ts`: validates the shared alert settings and decides what a completion does.
- `src/actions/preset-controller.ts`: wires everything without the SDK, so it is tested directly. Sends key events to the coordinator, paints renders, passes events to the alert and Focus dispatchers, saves every change, catches up after a restart (`recover`), redraws every key when a device reconnects, and through `src/actions/wake-timer.ts` wakes at the next moment the coordinator reports a change (ring step, minute boundary, completion, hold threshold).
- `src/alerts/dispatcher.ts`: turns each `completed` event into a sound and/or notification, once per session. `src/alerts/macos.ts` runs `afplay` and `osascript`.
  `osascript`'s `display notification` is attributed to Script Editor. Observed during development on macOS 27.0.1: the macOS notification log shows `Connection com.apple.ScriptEditor2 with path: /usr/bin/osascript`, then the banner is delivered and presented.
- `src/core/focus.ts`: validates Focus settings and maps session events to Focus start/end. `src/focus/dispatcher.ts` runs shortcuts in order, at most one start and one end per focus session. `src/focus/shortcuts.ts` runs and lists shortcuts with `/usr/bin/shortcuts`. `src/focus/picker.ts` fills the Property Inspector's pickers. `src/focus/status.ts` keeps the last-problem line.
- `src/persistence/store.ts`: the state file (below).
- `src/actions/timer-actions.ts`: the Stream Deck adapter. Two actions, Timer Preset (`focus` kind) and Break (`break` kind), forward SDK events to one shared `TimerKeys`, which owns the controller, paints keys with `setImage` and reads global settings. A break session is marked `kind: "break"` in the coordinator, its events and the state file; `focusIntent` treats every break event as an end, so a break never turns Focus on.
- `com.austinzani.focus-keys.sdPlugin/ui/preset.html`: the Property Inspector. Uses [sdpi-components](https://sdpi-components.dev) v4.0.1, vendored in `ui/vendor/` so it works offline; its MIT and bundled Lit BSD-3-Clause licenses are in `ui/vendor/LICENSES.md`.

## Coordinator events

All preset keys share one session. The coordinator reports each transition once: `started`, `paused`, `resumed`, `cancelled`, `completed` (with the session's length), and `replaced` (with the previous key and whether it was running or paused). Every event carries its session id. `replaced` also starts the new session with a new id, so it counts as a start for the new key.

Taps act on key release. If the hold wake-up runs late, the release still counts as a hold. If a session finishes while its key is held, the completion stands and the hold then clears the 0. If it finishes before a quick tap is released (including a late wake-up after sleep), the tap does nothing more. A tap does nothing if another key replaced its session while it was down.

## Clock-change policy

The session tracks an absolute wall-clock end time. Forward jumps, including sleep, count as elapsed. Backward jumps extend the session, but the key never shows more than the preset minutes or a full ring. The same holds across a restart, because the saved session is its end time.

## Persistence

State is saved to `~/Library/Application Support/com.austinzani.focus-keys/state.json` on every session change and on alert delivery. It's outside the plugin folder so it survives updates, and because packaged plugin files are immutable once DRM-protected. It holds the session, the session-id counter, the last alerted session id and the Focus record (session this plugin turned Focus on for, 0 if none). It isn't kept in Stream Deck global settings, because the Property Inspector rewrites that whole object when alert or Focus settings change.

- Versioned (currently 1). A file this version can't use is moved to `state.unsupported-<time>.json` with a warning, and the timer starts idle. If it can't be moved, the plugin runs without saving and logs `won't be saved this run` once.
- Atomic writes: a temporary file is flushed, then renamed. Leftover temp files are deleted at startup. A change in the same instant as quitting may be lost.
- Alerts: the delivery is saved (up to 2 s) before the sound or notification starts, so a crash between the two skips the alert rather than repeating it. If the save fails or times out, the alert plays anyway and could repeat after a restart before the next successful save.
- Focus: the record is saved before **On start** runs and cleared before **On end** runs, with the same 2 s limit and caveat. A restored running session doesn't re-run **On start**. If the plugin had turned Focus on and that work is no longer running at recovery, **On end** runs once.
- The saved key id is the SDK action id, assumed stable for the same placed key across restarts (owner check).
- Alert and Focus settings are read when needed with a 2 s timeout; on timeout alerts use defaults.

## Focus: restore rule and owner prototype

Restoring the previous Focus and detecting manual changes both need a reliable readback of the current Focus. Apple documents **Get Current Focus** (macOS 13) only as "checking current Focus status", so it's off until proven. Add a **Restore previous Focus** end option only if the prototype shows all of:

1. **Get Current Focus**, via `shortcuts run … --output-path -`, returns a non-empty value that differs per Focus and a distinct, stable value for "no Focus".
2. Feeding that value into a **Set Focus** shortcut restores every tested Focus and "no Focus", three times out of three.
3. No prompt after the first run, and it finishes within a few seconds.
4. The follow-up repeats checks 1 and 2 from the plugin (the Stream Deck process), whose permissions can differ from Terminal's.

Manual-change protection would read the current Focus at the end and skip **On end** if it's no longer the one the plugin set. `ShortcutRunner` would gain an output-capturing run.

The prototype is `scripts/focus-prototype.mjs`. It changes Focus on the Mac (and synced devices). Steps are in [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) section 5. It writes `focus-prototype-<time>.jsonl` (git-ignored) answering: Q1 Focus identity, Q2 no-Focus value, Q3 switching, Q4 restoring, Q5 manual and scheduled changes, Q6 permissions, Q7 banners under Focus.

## Fonts, glyphs and icons

Five OFL 1.1 fonts from Fontsource 5.3.0 (Inter Bold, Nunito ExtraBold, Oswald SemiBold, JetBrains Mono Bold, Bitter Bold). `npm run glyphs` extracts only digits 0–9 as SVG paths (about 28 KB), fails if a font isn't OFL or declares a Reserved Font Name, and copies each license plus a `NOTICE.txt` to `com.austinzani.focus-keys.sdPlugin/licenses/fonts/`. No font file ships or loads at runtime.

`npm run icons` (`scripts/generate-icons.mjs`) renders the plugin icon, category icon, action icon and default key image from the real key renderer, and writes Marketplace gallery mock renders to `release/gallery/` (git-ignored). Commit the regenerated PNGs.

## Packaging and release

1. Bump the version in both `package.json` (`x.y.z`) and the manifest `Version` (`x.y.z.0`). They must agree.
2. `npm run package`. `scripts/package.mjs`:
   - refuses if the manifest has `Nodejs.Debug` or the versions disagree;
   - builds with rollup (terser, no sourcemaps);
   - runs `streamdeck pack … --output release --force --no-update-check`, which validates first and won't pack an invalid plugin;
   - restores `manifest.json` afterwards, because `pack` rewrites it in its own formatting.
3. Output: `release/com.austinzani.focus-keys.streamDeckPlugin` (about 121 KiB, 21 files; `release/` is git-ignored).

What goes in: everything in the `.sdPlugin` folder except what `com.austinzani.focus-keys.sdPlugin/.sdignore` excludes (`logs/`, `.DS_Store`, `*.map`) and the CLI defaults (`.git`, `/.env*`, `*.log`, `*.js.map`). Rollup emits `bin/THIRD_PARTY_LICENSES.txt` with the notices of the npm packages bundled into `plugin.js` (@elgato/streamdeck, @elgato/utils, @elgato/schemas, @streamdeck/core, ws, zod: MIT; tslib: 0BSD), since terser strips license comments. Font and sdpi-components licenses ship in `licenses/fonts/` and `ui/vendor/LICENSES.md`.

Inspect a package with `unzip -l release/*.streamDeckPlugin`. To test it, follow section 1 of the acceptance checklist (unlink the dev build first). To return to development afterwards: uninstall the packaged copy in Stream Deck, then `npx streamdeck dev`, `npm run link`, `npm run restart`.

Marketplace submission is covered in [MARKETPLACE.md](MARKETPLACE.md).

## Renaming before first publish

The UUID must be final before the first Marketplace publish. Elgato's plugin guidelines say not to change UUIDs after publishing: a new UUID is a different plugin, and users' placed keys and settings don't carry over. Renaming beforehand is mechanical. Change every one of these:

| Where | What |
| --- | --- |
| `com.austinzani.focus-keys.sdPlugin/manifest.json` | `Name`, `Category`, `UUID`, the action UUIDs (`<uuid>.preset`, `<uuid>.break`) |
| `com.austinzani.focus-keys.sdPlugin/` | Folder name must be `<uuid>.sdPlugin` |
| `rollup.config.mjs` | `sdPlugin` constant |
| `package-lock.json` | `name` (run `npm install` after changing `package.json`) |
| `package.json` | `name`, and the `watch`, `validate`, `link`, `restart` scripts |
| `scripts/package.mjs` | `sdPlugin` constant |
| `scripts/generate-glyphs.mjs` | `licenseDir` |
| `scripts/generate-icons.mjs` | `imgs` path (plugin folder name) |
| `src/actions/timer-actions.ts` | `PRESET_ACTION_UUID`, `BREAK_ACTION_UUID` |
| `src/persistence/store.ts` | State folder under Application Support (old state is orphaned; fine before release) |
| `src/core/alerts.ts` | `NOTIFICATION_TITLE` (the banner title) |
| `src/plugin.ts` | Log lines |
| `test/` | `alerts`, `macos-alerts`, `alert-dispatcher`, `preset-controller` expectations; the temp-folder prefix in `persistence.test.ts`; the plugin path in `support.ts` |
| `scripts/focus-prototype.mjs` | Test shortcut names (optional) |
| `README.md`, `docs/` | Name, paths, UUID |

Then check nothing is left:

```sh
git grep -n -i -e 'focus-keys' -e 'focus keys'
```

Before testing the renamed build, unlink the old UUID (`npx streamdeck unlink com.austinzani.focus-keys`) and link the new folder.
