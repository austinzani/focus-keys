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

- `src/core/coordinator.ts` contains the timer logic and has no SDK imports. It takes key appearances, settings changes, key down/up, and clock ticks. It returns the image each key should show and the session transition events. A running session stores an absolute end time; a paused session stores its frozen remaining time.
- `src/render/key-image.ts` draws a key as SVG: a large whole-minute number, plus a ring while running (colored) or paused (muted grey, frozen).
- `src/actions/preset-timer.ts` is the Stream Deck adapter. It forwards key and settings events and paints keys with `setImage`. Through `src/actions/wake-timer.ts` it wakes at the exact moment the coordinator reports the next change: a ring step, a minute boundary, completion, or a hold reaching its threshold.
- `com.austinzani.neo-pomodoro.sdPlugin/ui/preset.html` is the Property Inspector. It uses [sdpi-components](https://sdpi-components.dev) v4.0.1, vendored in `ui/vendor/` so it works offline; its MIT and bundled Lit BSD-3-Clause licenses are in `ui/vendor/LICENSES.md`.

### Timer behavior

All preset keys share one session.

| Action | Result |
| --- | --- |
| Tap an idle or finished key | Starts a fresh session for that key's duration. |
| Tap the running key | Pauses. The number and ring freeze; the ring turns grey. |
| Tap the paused key | Resumes from the frozen remaining time. |
| Tap another key while a session is running or paused | Replaces the session. The old key returns to its idle number. No completion or cancellation is reported. |
| Hold the running or paused key for 600 ms | Cancels at 600 ms, while the key is still down. The key returns to its idle number. Releasing it does nothing more. |
| Hold the finished key for 600 ms | Clears the 0 back to the idle number. |
| Hold any other key | Nothing happens. A hold never starts a session. |

Taps act on key release, so a hold is never also counted as a tap. If the hold wake-up runs late, the release still counts as a hold. If a session finishes while its key is held, the completion stands and the hold then clears the 0. If it finishes before a quick tap is released, including when a late wake-up after sleep finds it already over, the tap does nothing more: it doesn't start a new session. Likewise, a tap does nothing if another key replaced its session while it was down.

The coordinator reports each transition once, as an event for the alert and Focus work (AUS-1882, AUS-1883) to use: `started`, `paused`, `resumed`, `cancelled`, `completed`, and `replaced` (with the previous key and whether it was running or paused). `replaced` also starts the new session, so it counts as a start for the new key.

### Preset durations

Each key's duration is a per-action setting edited in the Property Inspector. Stream Deck saves it, and the key reloads it when it appears, including after a restart.

- Valid values are whole minutes from 1 to 180. Three digits fit on the key with a smaller font.
- A new key shows 5, and the plugin saves 5 to its settings so the field shows it too.
- An unusable edit, such as an empty field or 200, is ignored, and the key keeps its previous duration. The field saves when you press Enter, click away, or close the Property Inspector, not on every keystroke, so typing 60 never briefly sets 6. When the Property Inspector closes, the plugin saves the duration the key is using in place of the unusable entry, so a restart doesn't fall back to 5.
- Editing an idle or finished key's duration takes effect at once.
- Editing the running or paused key's duration doesn't change the current session. The new duration applies the next time that key starts.

### Clock-change policy

The session tracks an absolute wall-clock end time. Forward clock jumps, including sleep, count as elapsed time. Backward jumps extend the session, but the key never shows more than the preset minutes or more than a full ring. The final policy may be refined in AUS-1884.

### Owner check on the Neo (AUS-1879, AUS-1880)

1. Build, link, and restart the plugin as described above.
2. In the Stream Deck app, find the **Neo Pomodoro** category and drag **Timer Preset** onto four Neo keys. Each key shows a large **5** on a dark background with no ring.
3. Select each key and set **Minutes** in the Property Inspector to **5**, **15**, **30**, and **60**. Press Enter or click away after each entry; the key's number then updates.
4. Press the **5** key. A ring appears and the number stays **5**. Watch it for about a minute. The ring shrinks smoothly, and the number changes to **4** exactly when four minutes remain. No seconds are ever shown.
5. Tap the running key. The ring turns grey and stops, and the number stays put. Wait a minute, then tap again. The ring returns to its color and the countdown continues from where it paused.
6. Press and hold the running key. At about half a second, the key returns to **5** while your finger is still down. Releasing it doesn't start a new timer. Repeat this with a paused key.
7. Start the **15** key, then press the **30** key. The 15 key shows **15** again and 30 starts counting. Nothing signals a completion.
8. Switch to another page and back while the timer runs. The key shows the current countdown.
9. Let the 5-minute timer finish. The key shows **0** with no ring and keeps showing it. Press it to start a fresh 5-minute countdown.
10. While a timer runs, change that key's minutes in the Property Inspector. The countdown continues unchanged. Hold to cancel; the key now shows the new value.
11. Quit and reopen Stream Deck, or run `npm run restart`. All four keys show their saved durations.

Notes: the action has no title field, so a user title can't hide the number. A custom image set on the key in the Stream Deck app still overrides the plugin's image. If the number doesn't appear, clear any custom image on that key. A running session isn't restored after a restart yet; that's AUS-1884.
