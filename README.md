# Stream Deck Neo Pomodoro Timer

A planned Mac-only Stream Deck plugin for a quiet, readable whole-minute countdown. The name is a working title.

The [specification](docs/spec-draft.md), [ticket breakdown](docs/tickets-draft.md), and [platform research](docs/research.md) capture the approved scope. The Linear spec and its child issues are the tracker source of truth.

Linear project: Stream Deck Neo — Pomodoro Timer.

Start with AUS-1879, the first unblocked implementation issue. The Neo Infobar is deferred; public release follows successful owner testing.

## Development

The plugin lives in `com.austinzani.neo-pomodoro.sdPlugin/`. The name and UUID are provisional; the final name is chosen during Marketplace preparation (AUS-1885).

### Prerequisites

- macOS 12 or later with Stream Deck 7.1 or later
- Node.js 24 or later and npm
- The Elgato CLI comes in as a dev dependency. Run it with `npx streamdeck` and don't install it globally.

### Build and install for development

```sh
npm install
npm run build        # bundles src/ into com.austinzani.neo-pomodoro.sdPlugin/bin/plugin.js
npx streamdeck dev   # once per machine: enables Stream Deck developer mode
npm run link         # symlinks the .sdPlugin folder into Stream Deck's Plugins folder
npm run restart      # reloads the plugin after each build
npm run watch        # optional: rebuild and restart on every change
```

Plugin logs are written to `com.austinzani.neo-pomodoro.sdPlugin/logs/`. Stream Deck's own log is `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`.

### Checks

```sh
npm test             # vitest behavior tests, driven by a controlled clock
npm run typecheck
npm run validate     # streamdeck validate on the .sdPlugin folder
```

### Layout

- `src/core/coordinator.ts` contains the timer logic and has no SDK imports. It takes key appearances, key presses, and clock ticks, and returns the image each key should show. The running session stores an absolute end time.
- `src/render/key-image.ts` draws a key as SVG: a large whole-minute number, plus a ring while running.
- `src/actions/preset-timer.ts` is the Stream Deck adapter. It forwards key events, paints keys with `setImage`, and schedules the next redraw at the exact moment the coordinator reports the next change (a ring step, a minute boundary, or completion).

### Clock-change policy

The session tracks an absolute wall-clock end time. Forward clock jumps, including sleep, count as elapsed time. Backward jumps extend the session, but the key never shows more than the preset minutes or more than a full ring. The final policy may be refined in AUS-1884.

### Owner check on the Neo (AUS-1879)

1. Build, link, and restart the plugin as described above.
2. In the Stream Deck app, find the **Neo Pomodoro** category and drag **Timer Preset** onto a Neo key. The key shows a large **5** on a dark background with no ring.
3. Press the key. A ring appears and the number stays **5**.
4. Watch it for about a minute. The ring shrinks smoothly, and the number changes to **4** exactly when four minutes remain. No seconds are ever shown.
5. Switch to another page and back while the timer runs. The key shows the current countdown.
6. After five minutes the key shows **0** with no ring and stays at 0.
7. Press the finished key. A new five-minute countdown starts at **5**.

Notes: the action has no title field, so a user title can't hide the number. A custom image set on the key in the Stream Deck app still overrides the plugin's image. If the number doesn't appear, clear any custom image on that key. Pressing a running key does nothing for now; pause, resume, and hold-to-cancel arrive in AUS-1880.
