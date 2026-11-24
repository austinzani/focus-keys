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
npm run preview      # PNG contact sheets of every font, state and sample color in ./preview (git-ignored)
npm run glyphs       # regenerates src/render/glyphs.generated.ts and the font licenses; commit the output
```

`npm run preview -- <dir>` writes the sheets somewhere else. They're rendered by resvg at 72 px and 144 px, the SDK's 1x and @2x key image sizes, and at 96 px, the Neo's physical key panel according to the python-elgato-streamdeck device table. Elgato's docs don't state a Neo-specific size. resvg is a stand-in for Stream Deck's own rasterizer, so the sheets don't replace the check on the Neo.

### Layout

- `src/core/coordinator.ts` contains the timer logic and has no SDK imports. It takes key appearances, settings changes, key down/up, and clock ticks. It returns the image each key should show and the session transition events. A running session stores an absolute end time; a paused session stores its frozen remaining time.
- `src/core/key-style.ts` validates each key's color and font settings.
- `src/render/key-image.ts` draws a key as SVG: a large whole-minute number, plus a ring while running (key color) or paused (muted, frozen). Digits are drawn as path outlines from `src/render/glyphs.generated.ts`, so the look doesn't depend on fonts installed on the Mac.
- `src/core/alerts.ts` validates the shared alert settings and decides what a completion does: which sound, and whether to show a notification with what text.
- `src/actions/preset-controller.ts` wires everything without the SDK, so it is tested directly. It sends key events to the coordinator, paints its renders, passes its events to the alert dispatcher, and through `src/actions/wake-timer.ts` wakes at the exact moment the coordinator reports the next change: a ring step, a minute boundary, completion, or a hold reaching its threshold.
- `src/alerts/dispatcher.ts` turns each `completed` event into a sound and/or notification, once per session. `src/alerts/macos.ts` plays sounds with `afplay` and shows notifications with `osascript`.
- `src/core/focus.ts` validates the shared Focus settings and maps each session event to a Focus start or end. `src/focus/dispatcher.ts` runs the user's Focus shortcuts in order, at most one start and one end per focus session. `src/focus/shortcuts.ts` runs and lists shortcuts with `/usr/bin/shortcuts`; `src/focus/picker.ts` fills the Property Inspector's shortcut pickers. `src/focus/status.ts` keeps the Property Inspector's last-Focus-problem line.
- `src/actions/preset-timer.ts` is the Stream Deck adapter. It forwards SDK key and settings events to the controller, paints keys with `setImage`, and reads the alert settings from the plugin's global settings.
- `com.austinzani.neo-pomodoro.sdPlugin/ui/preset.html` is the Property Inspector. It uses [sdpi-components](https://sdpi-components.dev) v4.0.1, vendored in `ui/vendor/` so it works offline; its MIT and bundled Lit BSD-3-Clause licenses are in `ui/vendor/LICENSES.md`.

### Timer behavior

All preset keys share one session.

| Action | Result |
| --- | --- |
| Tap an idle or finished key | Starts a fresh session for that key's duration. |
| Tap the running key | Pauses. The number and ring freeze; the ring turns a muted shade of the key color and the number dims. |
| Tap the paused key | Resumes from the frozen remaining time. |
| Tap another key while a session is running or paused | Replaces the session. The old key returns to its idle number. No completion or cancellation is reported. |
| Hold the running or paused key for 600 ms | Cancels at 600 ms, while the key is still down. The key returns to its idle number. Releasing it does nothing more. |
| Hold the finished key for 600 ms | Clears the 0 back to the idle number. |
| Hold any other key | Nothing happens. A hold never starts a session. |

Taps act on key release, so a hold is never also counted as a tap. If the hold wake-up runs late, the release still counts as a hold. If a session finishes while its key is held, the completion stands and the hold then clears the 0. If it finishes before a quick tap is released, including when a late wake-up after sleep finds it already over, the tap does nothing more: it doesn't start a new session. Likewise, a tap does nothing if another key replaced its session while it was down.

The coordinator reports each transition once, as an event for the alert and Focus work (AUS-1882, AUS-1883) to use: `started`, `paused`, `resumed`, `cancelled`, `completed` (with the session's length), and `replaced` (with the previous key and whether it was running or paused). Every event carries its session id. `replaced` also starts the new session, with a new id, so it counts as a start for the new key.

### Completion alerts

When a session reaches zero, its key shows **0** and the plugin plays the selected sound once and, if enabled, shows a macOS notification. Only `completed` alerts. Cancelling (hold), replacing (another preset), and pausing never do. A session that completes while its key is on another page, or while the Property Inspector is closed, still alerts on time. Each session alerts at most once, keyed by its session id.

The settings are in an **Alerts** section at the bottom of every timer key's Property Inspector. They are plugin global settings, so all keys share one set, and they are read when a session completes. If Stream Deck doesn't return them within 2 seconds, that completion uses the defaults.

| Setting | Default | Notes |
| --- | --- | --- |
| Sound | Glass | Glass, Hero, Ping, Submarine, Funk, Blow, Purr, Tink, or **None (silent)**. |
| Notification | Off | Shows a banner titled "Neo Pomodoro". |
| Text | `Time's up: {minutes}-minute timer finished.` | Used when the field is empty. `{minutes}` becomes the session's length. Up to 200 characters. Saves when you click away or close the Property Inspector, not on every keystroke. |

Sound and notification are independent; you can turn either off, or both. The sounds are the built-in files in `/System/Library/Sounds`, played with `/usr/bin/afplay`. No sound file is bundled, so there's nothing to license. Playback doesn't depend on notification permission or Focus. It does follow the Mac's output volume and mute.

The notification runs `/usr/bin/osascript` with AppleScript's `display notification`. It never sets a notification sound, so the only sound is the one above and nothing plays twice. The text is passed as arguments to the script's `on run argv` handler, never pasted into script source. Quotes, backslashes, newlines and emoji arrive unchanged, and text can't run as script. Both programs are run directly, without a shell.

How macOS treats these notifications:

- macOS attributes them to **Script Editor** (`com.apple.ScriptEditor2`), not to Stream Deck or this plugin. (Observed during development on macOS 27.0.1: the notification log shows `Connection com.apple.ScriptEditor2 with path: /usr/bin/osascript`, then the banner is delivered and presented.) Allowing, denying, or changing the banner style is done under **System Settings › Notifications › Script Editor**. Other scripts that use `display notification` share that setting.
- If Script Editor hasn't asked before, macOS may ask for permission on the first notification.
- A Focus mode can hide or delay the banner unless Script Editor is allowed in that Focus. Notification Center may still list it.
- `osascript` exits successfully even when banners are denied or hidden, so the plugin can't detect authorization. The Property Inspector explains this. A failed or timed-out `osascript` or `afplay` is logged in the plugin log and doesn't affect the timer.
- A notification under the plugin's own name would need a separate signed helper app using `UNUserNotificationCenter`. That isn't needed: the Script Editor route works without private APIs, extra binaries or network access.

### Preset durations

Each key's duration is a per-action setting edited in the Property Inspector. Stream Deck saves it, and the key reloads it when it appears, including after a restart.

- Valid values are whole minutes from 1 to 180. Three digits fit on the key at a smaller size.
- A new key shows 5, and the plugin saves 5 to its settings so the field shows it too.
- An unusable edit, such as an empty field or 200, is ignored, and the key keeps its previous duration. The field saves when you press Enter, click away, or close the Property Inspector, not on every keystroke, so typing 60 never briefly sets 6. When the Property Inspector closes, the plugin saves the duration the key is using in place of the unusable entry, so a restart doesn't fall back to 5.
- Editing an idle or finished key's duration takes effect at once.
- Editing the running or paused key's duration doesn't change the current session. The new duration applies the next time that key starts.

### KeyStyle

Each key has its own **Color** and **Font** in the Property Inspector. They're per-action settings, saved by Stream Deck like the duration, and they save as soon as you change them. Changing either one only redraws that key. It never affects the timer, its remaining time, or the key's duration, even mid-session.

| Key state | Number | Ring |
| --- | --- | --- |
| Idle | Key color | None |
| Running | White | Key color, covering the remaining fraction, on a dark grey track |
| Paused | Dimmed grey (#a3a3a3) | Key color mixed 60% toward grey #5a5a5a, frozen |
| Finished | White **0** | None |

- The default color is tomato `#ff6347`. Colors are `#rrggbb` (`#rgb` is expanded). Anything else falls back to the default.
- A color too dark to see on the `#111111` key, such as navy or black, is lightened toward white just enough to reach a 4.5:1 contrast ratio. The Property Inspector still shows the color you picked.
- Paused stays distinguishable from running even when the key color is white or grey, because the number dims too. With a grey key color, the dimmed number is the only clear difference, since a muted grey ring looks almost the same as the running one.
- Each number is drawn as large as fits inside the ring, up to a fixed maximum digit height. Short numbers and condensed fonts come out taller. Idle keys use the same size, so the number doesn't jump when a key starts.

Five number fonts, all under the SIL Open Font License 1.1 with no Reserved Font Name. They come from the [Fontsource](https://fontsource.org) npm packages (5.3.0):

| Font | Weight | Why |
| --- | --- | --- |
| Inter (default) | Bold 700 | Neutral grotesk designed for screens; the most legible at key size. |
| Nunito | ExtraBold 800 | Rounded terminals; a softer look. |
| Oswald | SemiBold 600 | Condensed; tall digits, so three-digit numbers stay large. |
| JetBrains Mono | Bold 700 | Monospace; every digit is the same width, so the number doesn't shift as it counts. |
| Bitter | Bold 700 | Slab serif; the most distinct of the five. |

`npm run glyphs` extracts only the digits 0–9 from each font and stores them as SVG path data, about 28 KB in all. It fails if a font isn't OFL or declares a Reserved Font Name, and it copies each license to `com.austinzani.neo-pomodoro.sdPlugin/licenses/fonts/`, along with a generated `NOTICE.txt`. OFL allows bundling with software as long as the license goes with it. No font file ships, and none is loaded at runtime. An unknown font setting falls back to Inter. If a digit had no outline, the key falls back to plain SVG text in the system sans-serif font.

### Clock-change policy

The session tracks an absolute wall-clock end time. Forward clock jumps, including sleep, count as elapsed time. Backward jumps extend the session, but the key never shows more than the preset minutes or more than a full ring. The final policy may be refined in AUS-1884.

### Owner check on the Neo (AUS-1879, AUS-1880)

1. Build, link, and restart the plugin as described above.
2. In the Stream Deck app, find the **Neo Pomodoro** category and drag **Timer Preset** onto four Neo keys. Each key shows a large tomato **5** on a dark background with no ring.
3. Select each key and set **Minutes** in the Property Inspector to **5**, **15**, **30**, and **60**. Press Enter or click away after each entry; the key's number then updates.
4. Press the **5** key. A ring appears and the number stays **5**. Watch it for about a minute. The ring shrinks smoothly, and the number changes to **4** exactly when four minutes remain. No seconds are ever shown.
5. Tap the running key. The ring turns a muted shade and stops, the number dims and stays put. Wait a minute, then tap again. The ring returns to its color and the countdown continues from where it paused.
6. Press and hold the running key. At about half a second, the key returns to **5** while your finger is still down. Releasing it doesn't start a new timer. Repeat this with a paused key.
7. Start the **15** key, then press the **30** key. The 15 key shows **15** again and 30 starts counting. Nothing signals a completion.
8. Switch to another page and back while the timer runs. The key shows the current countdown.
9. Let the 5-minute timer finish. The key shows **0** with no ring and keeps showing it. Press it to start a fresh 5-minute countdown.
10. While a timer runs, change that key's minutes in the Property Inspector. The countdown continues unchanged. Hold to cancel; the key now shows the new value.
11. Quit and reopen Stream Deck, or run `npm run restart`. All four keys show their saved durations.

### Owner check on the Neo: appearance (AUS-1881)

Do this on the physical Neo at normal viewing distance. Compare against the contact sheets from `npm run preview`.

1. Set four keys to **5**, **15**, **30**, and **60**, and a fifth to **180** if a key is free. Leave each on its default appearance: tomato idle numbers in Inter, on black.
2. For each font (Inter, Nunito, Oswald, JetBrains Mono, Bitter), select it on all keys and check:
   - The idle numbers, including **180**, are large, sharp, centered, and never clipped by the key edge.
   - Start a key. The white running number and the colored ring are clear, and the ring doesn't touch the digits.
   - Pause it. The muted ring and dimmed number are readable and clearly different from running at a glance.
   - Let a 1-minute key finish. The **0** is readable.
3. Pick a few colors: blue, green, yellow, white, a mid grey such as `#808080`, and a very dark one such as navy. Each key shows its own color. Navy is drawn lighter but still blue, and visible. For each color, paused is clearly different from running, and the muted paused ring is still visible against the dark track.
4. While a timer runs, change its key's color, then its font. The key redraws at once, and the minute and ring carry on from where they were. Change another key's appearance mid-session; the running key is unaffected.
5. Run `npm run restart` or reopen Stream Deck. Every key keeps its color and font.
6. Note any font or color that's hard to read on the Neo, so it can be swapped before release.

Notes: the action has no title field, so a user title can't hide the number. A custom image set on the key in the Stream Deck app still overrides the plugin's image. If the number doesn't appear, clear any custom image on that key. A running session isn't restored after a restart yet; that's AUS-1884.

### Focus

Optional and off by default. macOS has no supported way for a plugin to set Focus directly, so the plugin runs **shortcuts you make in the Shortcuts app** with Apple's `shortcuts` command (`/usr/bin/shortcuts run -- <name>`, no shell, 30-second limit). Your shortcut does the switching with the Shortcuts **Set Focus** action. No private APIs or Focus databases are used.

Setup:

1. In the Shortcuts app, make a shortcut (for example "Pomodoro Focus On") with one **Set Focus** action: turn your work Focus **On**, until **Turned Off**.
2. Optionally make a second one (for example "Pomodoro Focus Off") with **Set Focus** turning Focus **Off**.
3. Open any timer key's Property Inspector. In **Focus — shared by all timer keys**, check **Switch Focus with the timer**, pick the first shortcut under **On start** and the second under **On end** (or **Leave Focus as it is**). The pickers list your shortcuts; use the refresh button after adding one. A chosen shortcut that was renamed or deleted shows "(not found)".
4. The first run may ask for permission (for example to let Shortcuts change Focus, or to let Stream Deck run shortcuts). Allow it; until then the shortcut fails and the key shows an alert.

When each shortcut runs. Focus follows the focus session, not a key:

| Timer event | Focus |
| --- | --- |
| Start | Runs **On start** |
| Pause, cancel (hold), finish | Runs **On end**, or leaves Focus as it is if none is chosen |
| Resume | Runs **On start** |
| Another preset replaces running work | Nothing: the focus session continues |
| Another preset replaces paused work | Runs **On start** (the pause already ran **On end**) |
| Focus switching off | Nothing ever runs |

Each focus session runs **On start** at most once and **On end** at most once. Events are deduplicated by session id: a repeated start or finish, or a late event from an earlier session, changes nothing. **On end** only follows an **On start** that this plugin ran, so it never turns off a Focus the timer didn't turn on (exact rule under Limits). Turning switching off mid-session means **On end** doesn't run. Shortcuts run one at a time in the order the timer events happened, in the background: a slow shortcut never delays the countdown, and an end always waits for its start. While a shortcut is still running, only the latest timer change waits behind it; an older waiting one is dropped, because Focus only needs to end up matching the timer. So pausing and resuming repeatedly while a shortcut hangs runs at most one more shortcut, and a waiting start that a pause replaces never runs.

Limits:

- **Your previous Focus is not restored.** At the end the plugin runs your **On end** shortcut (or leaves Focus alone). Apple documents **Get Current Focus** (macOS 13) only as "checking current Focus status". It has not yet been shown on this Mac that it returns a Focus that can be fed back into **Set Focus**, or how "no Focus" looks. Restoring stays off until the owner prototype below proves it.
- **Changes you make by hand aren't detected.** If you switch Focus during a timer, **On end** still runs when the timer pauses or finishes, and it may undo your change. Whether a "Focus off" shortcut also turns off a different Focus you chose by hand is not yet tested (prototype Q5). The plugin can't tell a scheduled change from a manual one. Choose **Leave Focus as it is** to avoid this.
- **On end needs On start.** **On end** runs only if this focus session's **On start** finished successfully or hit the 30-second limit (a shortcut stopped at the limit may already have set Focus, so it counts as started). It doesn't run when **On start** is **None**, switching was off at the start, the start shortcut was missing or failed with an error, or the settings couldn't be read at the start.
- **Shortcut names are trimmed.** A shortcut whose name starts or ends with spaces can't be chosen; rename it in the Shortcuts app.
- **The "No shortcut named …" message relies on the `shortcuts` command's English error text** ("Couldn't find shortcut"). In another macOS language a missing shortcut is reported with the command's own error instead.
- **Focus syncs across devices.** If **Share across devices** is on in System Settings › Focus, these changes also apply to your iPhone, iPad and other Macs.
- A Focus may hide the completion banner unless **Script Editor** is allowed in that Focus (see Completion alerts). The sound is played with `afplay` and isn't affected.
- A shortcut that asks a question waits for an answer. The plugin stops it after 30 seconds and reports a timeout (then still runs **On end**, as above).

When a shortcut can't run (missing or renamed shortcut, an error inside it, permission denied, 30-second timeout, or no `shortcuts` command), or the Focus settings can't be read when work starts, the timer carries on. The key that started the session shows Stream Deck's alert triangle briefly. The Focus section of the Property Inspector shows the latest problem, such as `No shortcut named "Pomodoro Focus On" in the Shortcuts app`, until a shortcut next runs successfully or you change the Focus settings; the plugin log has the details. An unreadable-settings alert is skipped when switching was off the last time the settings were read.

Restoring later, by this rule: add a **Restore previous Focus** end option only if the prototype shows all of these:

1. **Get Current Focus** returns, through `shortcuts run … --output-path -`, a non-empty value that differs for each Focus and has a distinct, stable value for "no Focus".
2. Feeding that value back into a **Set Focus** shortcut restores every tested Focus and "no Focus", three times out of three.
3. It needs no prompt after the first run and finishes within a few seconds.
4. The follow-up that adds the option repeats checks 1 and 2 from the plugin (the Stream Deck process) before shipping, since its permissions can differ from Terminal's.

Manual-change protection needs the same readback. At the end the plugin would read the current Focus and skip **On end** if it's no longer the one the plugin set. `ShortcutRunner` would then gain an output-capturing run; the dispatcher already knows when it started a focus session.

### Owner prototype: Focus via Shortcuts (AUS-1883)

This changes Focus on the Mac and, with sharing on, on synced devices. Takes about 10 minutes.

1. In the Shortcuts app, create:
   - **Neo Pomodoro Test - Get Focus**: **Get Current Focus**, then **Stop and Output** the result (as text if offered).
   - **Neo Pomodoro Test - Focus On**: **Set Focus** to your work Focus, **On**, until **Turned Off**.
   - **Neo Pomodoro Test - Focus Off**: **Set Focus**, **Off**.
   - **Neo Pomodoro Test - Set Focus From Input**: receives text input; **Set Focus** with the Focus set to **Shortcut Input** (if the action can't take a variable there, note it: that alone answers Q4 "no"). If the input is empty, turn Focus off.
2. In Terminal, in this repo: `node scripts/focus-prototype.mjs`. Follow the prompts. Every run's exit code, output, error and time goes to `focus-prototype-<time>.jsonl`.
3. What the results answer:
   - Q1 Focus identity: the `get-current` lines for Do Not Disturb, work and a third Focus. Is the output a name, and is it the same both times?
   - Q2 No Focus: the `get-current: NO Focus` lines. Empty, an error, or text?
   - Q3 Switching: `focus-on`/`focus-off` exit 0, times, and your yes/no.
   - Q4 Restoring: the `restore:` lines. Does the read-back match the capture, including NO Focus?
   - Q5 Manual and scheduled changes: `manual: read after hand change` and `scheduled: …` show whether a change is visible (only by reading; there is no change notification). Your answers show what **On end** does to it.
   - Q6 Permissions: your notes on prompts during the first runs.
   - Q7 Banners: whether the Script Editor banner showed with the work Focus on.
4. Then check the plugin itself: set **On start**/**On end** to the Focus On/Off test shortcuts and follow the owner checklist below. The plugin runs shortcuts from the Stream Deck process, and its permissions can differ from Terminal's.

Send the `.jsonl` file back. If it meets the restoring rule above, a follow-up can add the restore option. Otherwise the current fallback stays.

### Owner check on the Mac: Focus (AUS-1883)

1. Open a timer key's Property Inspector. **Focus — shared by all timer keys** shows switching unchecked. Start and finish a 1-minute timer: Focus doesn't change.
2. Check switching, set **On start** to your Focus On shortcut and **On end** to your Focus Off shortcut. The pickers list your shortcuts.
3. Start a timer. Your work Focus turns on within a second or two (accept any permission prompt and note it). Pause: Focus turns off. Resume: on again. Let it finish: off.
4. Start one key, then press another key while it runs. Focus stays on, with no off-then-on flicker. Pause, then press a third key: Focus comes back on. Hold to cancel: off.
5. Set **On end** to **Leave Focus as it is**. Start and finish a timer: Focus turns on and stays on. Turn it off by hand.
6. Start a timer, then switch to Do Not Disturb by hand. When the timer finishes, **On end** runs anyway. Note whether it turned your Do Not Disturb off.
7. Rename the Focus On shortcut in the Shortcuts app and start a timer. The countdown runs normally, the key flashes an alert, and the Property Inspector shows `No shortcut named …`. The picker shows the old name with "(not found)". Rename it back.
8. Uncheck switching mid-timer. When the timer ends, Focus is left on.
9. With the work Focus on and the notification enabled, let a timer finish with **On end** set to **Leave Focus as it is**. Note whether the Script Editor banner appears; the sound plays either way.
10. If **Share across devices** is on, confirm your iPhone follows, then decide whether that's acceptable.
11. Check the plugin log for `Focus shortcut … failed` only where expected.

### Owner check on the Mac: completion alerts (AUS-1882)

Use a key set to **1** minute. Have Mac volume up and no Focus on unless a step says otherwise.

1. Open any timer key's Property Inspector. The **Alerts — shared by all timer keys** section shows Sound **Glass**, Notification unchecked, and an empty Text box.
2. Start the 1-minute key and let it finish. The key shows **0**, Glass plays once, and no banner appears.
3. Choose each sound in turn (Hero, Ping, Submarine, Funk, Blow, Purr, Tink) and let a 1-minute timer finish for at least two of them. Each is audible and plays once. To audition every sound quickly, run `afplay /System/Library/Sounds/Hero.aiff` and so on in Terminal; the plugin plays the same files.
4. Choose **None (silent)**. A finished timer shows **0** with no sound.
5. Open a different key's Property Inspector. It shows the same alert settings; changing them there changes them for every key.
6. Check **Show a macOS notification** and leave the text empty. When a timer finishes, a banner from **Script Editor** says "Neo Pomodoro / Time's up: 1-minute timer finished." Only the selected sound plays, not a second notification sound. If macOS asks to allow Script Editor notifications, allow it and note that you were asked.
7. Enter custom text such as `Stretch "now" — {minutes} min 🍅`. The banner shows it exactly, with `{minutes}` replaced.
8. Set Sound to **None** with the notification on. The banner appears silently. Then set a sound with the notification off. Only the sound plays.
9. In **System Settings › Notifications › Script Editor**, turn off **Allow notifications**. A finished timer still shows **0** and plays its sound, and the next timer starts normally. Turn it back on afterwards.
10. Turn on a Focus that doesn't allow Script Editor. The banner may not appear, but the sound still plays.
11. Start a key, then hold it to cancel. Wait past its end. Nothing plays. Start a 1-minute key, then press another key before it finishes. No alert comes when the first minute would have ended, only when the second session ends.
12. Start a 1-minute key and switch the Neo to another page. When the minute is up, the sound plays once. Switch back; the key shows **0**.
13. Check `com.austinzani.neo-pomodoro.sdPlugin/logs/` for `alert session=… sound=… notification=…` lines and no errors.
