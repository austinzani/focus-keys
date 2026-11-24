# Owner acceptance checklist

One real-device pass on the Mac and Neo before Marketplace submission. It replaces the separate owner checks from AUS-1879 to AUS-1884 and adds install and uninstall (AUS-1885). Behavior details are in [USER_GUIDE.md](USER_GUIDE.md).

## Before you start

- Build the package: `npm run package` → `release/com.austinzani.focus-keys.streamDeckPlugin`.
- Use short presets (1–2 minutes) where a step waits for a finish.
- Mac volume up, no Focus on unless a step says otherwise.
- Installed plugin log: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.austinzani.focus-keys.sdPlugin/logs/`. Look for `session {…}`, `restored session …` and `alert session=… sound=… notification=…` lines.
- State file: `~/Library/Application Support/com.austinzani.focus-keys/state.json`. Reset: quit Stream Deck, delete the folder, reopen.
- "One alert" means one sound sequence (one play for Short or five for Long) and at most one banner, never two.

### Release blockers vs. notes

- **Blocker:** install fails or the plugin doesn't start; wrong minutes shown; a timer doesn't finish, finishes at the wrong time, or starts/cancels when it shouldn't; a missed or repeated alert; a Focus shortcut repeated or run when it shouldn't be; a crash or error in the log during normal use; a number that's unreadable on the Neo with the default look.
- **Note (fix if cheap):** cosmetic issues, a font or color that's hard to read but not the default, unclear wording in the Property Inspector.

## 1. Install from the package on a clean setup

- [ ] 1. Remove the dev link: `npx streamdeck unlink com.austinzani.focus-keys`. In Stream Deck › Preferences › Plugins, Focus Keys is gone, and `~/Library/Application Support/com.elgato.StreamDeck/Plugins/` has no `com.austinzani.focus-keys.sdPlugin`.
- [ ] 2. Optional, closer to a user's Mac: `npx streamdeck dev --disable`, and move `~/Library/Application Support/com.austinzani.focus-keys/` aside for a fresh state.
- [ ] 3. Double-click the `.streamDeckPlugin` file. Stream Deck asks to install; confirm. Expected: the **Focus Keys** category appears with **Timer Preset** and **Break** (cup icon), each with its icon in the action list and in Preferences › Plugins showing version 0.1.1.0.
- [ ] 4. The installed folder's `logs/` contains a log with `Focus Keys plugin connected` and no errors.

## 2. Four-key timer

- [ ] 1. Drag **Timer Preset** onto four Neo keys. Each shows a large tomato **5** on a dark background, no ring.
- [ ] 2. Set **Minutes** to **5**, **15**, **30** and **60** (Enter or click away after each). Each key's number updates.
- [ ] 3. Type an unusable value (empty, `0`, `200`) and click away. The key keeps its previous number. Close and reopen the Property Inspector: the field shows the key's number.
- [ ] 4. Press **5**. A ring appears and the number stays **5**. Over a minute the ring shrinks and the number becomes **4** when four minutes remain. No seconds ever.
- [ ] 5. Tap the running key: ring turns muted and stops, number dims. Wait a minute, tap again: ring regains its color and the countdown continues from where it paused.
- [ ] 6. Hold the running key: at about half a second it returns to **5** while your finger is still down; releasing does nothing more. Repeat with a paused key.
- [ ] 7. Start **15**, then press **30**. The 15 key shows **15** again and 30 counts. No alert.
- [ ] 8. Switch to another page and back while a timer runs. The key shows the current countdown.
- [ ] 9. Let a 1-minute key finish. It shows **0** with no ring and stays there. Tap it: a fresh countdown starts. Let it finish again and hold it: it clears to its idle number.
- [ ] 10. While a timer runs, change that key's minutes. The countdown continues unchanged. Hold to cancel; the key now shows the new value.
- [ ] 11. Quit and reopen Stream Deck. All four keys show their saved durations.
- [ ] 12. Drag **Break** onto a fifth key: it shows a teal **5**, and its Property Inspector shows Color teal. Start a 30 key, then press Break: the 30 key goes idle and Break counts. Let Break finish: sound plays, key shows **0**.

## 3. Appearance per font and color

Compare with the contact sheets from `npm run preview` if useful.

- [ ] 1. With default color, for each font (Inter, Nunito, Oswald, JetBrains Mono, Bitter) on all keys, plus a key set to **180** if one is free: idle numbers are large, sharp, centered and never clipped; running number and ring are clear and the ring doesn't touch the digits; paused is readable and clearly different from running at a glance; a finished **0** is readable.
- [ ] 2. Colors: blue, green, yellow, white, mid grey `#808080`, navy. Each key shows its own color. Navy is drawn lighter but still blue and visible. Paused stays distinguishable from running, and the muted paused ring is visible against the track.
- [ ] 3. Mid-timer, change the running key's color, then its font. It redraws at once and the minutes and ring carry on. Changing another key's look doesn't affect the running key.
- [ ] 4. Reopen Stream Deck. Every key keeps its color and font.
- [ ] 5. Note any font or color that's hard to read on the Neo.

## 4. Alerts

Use a 1-minute key.

- [ ] 1. **Alerts — shared by all timer keys** shows Sound **Glass**, Notification unchecked, Text empty.
- [ ] 2. Let it finish: **0**, Glass plays once, no banner.
- [ ] 3. Try at least two other sounds (Hero, Ping, Submarine, Funk, Blow, Purr, Tink). Each plays once. (`afplay /System/Library/Sounds/Hero.aiff` auditions them in Terminal.)
- [ ] 4. **None (silent)**: a finish shows **0** with no sound.
- [ ] 5. Another key's Property Inspector shows the same alert settings; changes apply to all keys.
- [ ] 6. Check **Show a macOS notification**, text empty. On finish macOS asks whether **Focus Keys** may send notifications; allow. A banner from **Focus Keys** (ring icon) reads "Focus Keys / Time's up: 1-minute timer finished." Only the chosen sound plays. If it came from Script Editor instead, the log says why (`Notification helper failed`): that's a blocker for the helper, not for release (the fallback works).
- [ ] 7. Text `Stretch "now" — {minutes} min 🍅`: the banner shows it exactly with `{minutes}` replaced.
- [ ] 8. Sound **None** with notification on: silent banner. A sound with notification off: sound only.
- [ ] 9. System Settings › Notifications › Focus Keys › Allow notifications off: a finish still shows **0** and plays the sound, no Script Editor banner appears, the next timer starts normally. Turn it back on.
- [ ] 10. A Focus that doesn't allow Focus Keys: the banner may not show; the sound plays.
- [ ] 11. Start, hold to cancel, wait past the end: nothing plays. Start a 1-minute key, press another before it ends: no alert at the first minute, only when the second timer ends.
- [ ] 12. Start a 1-minute key and switch pages: the sound plays once on time; switching back shows **0**.
- [ ] 13. Log shows `alert session=…` lines and no errors.
- [ ] 14. Set **Sound length** to **Long**: a finished timer plays the chosen sound five times, with a pause between plays, and sends at most one notification. **Short** plays it once; **None (silent)** remains silent for either length. The setting is shared by all keys and survives restart.

## 5. Focus

### 5a. Prototype in Terminal (about 10 minutes; changes Focus on this Mac and synced devices)

- [ ] 1. In Shortcuts, create:
  - **Focus Keys Test - Get Focus**: **Get Current Focus**, then **Stop and Output** the result (as text if offered).
  - **Focus Keys Test - Focus On**: **Set Focus** your work Focus **On**, until **Turned Off**.
  - **Focus Keys Test - Focus Off**: **Set Focus** **Off**.
  - **Focus Keys Test - Set Focus From Input**: receives text; **Set Focus** with Focus set to **Shortcut Input**; if input is empty, turn Focus off. If the action can't take a variable there, note it (that answers Q4 "no").
- [ ] 2. In the repo: `node scripts/focus-prototype.mjs`; follow the prompts. Results go to `focus-prototype-<time>.jsonl`.
- [ ] 3. Record answers: Q1 is `get-current` a stable Focus name? Q2 what does "no Focus" return? Q3 do on/off exit 0 and how fast? Q4 does the `restore:` read-back match, including no Focus? Q5 are manual and scheduled changes visible by reading, and what does Focus Off do to a hand-chosen Focus? Q6 which prompts appeared? Q7 did the Script Editor banner show with the work Focus on?
- [ ] 4. Send back the `.jsonl` file. Restore stays off unless it meets the rule in DEVELOPMENT.md.

### 5b. Plugin Focus switching

- [ ] 1. **Focus — shared by all timer keys** shows switching unchecked. Start and finish a 1-minute timer: Focus doesn't change.
- [ ] 2. Check **Switch Focus with the timer**; **On start** = Focus On shortcut, **On end** = Focus Off shortcut. The pickers list your shortcuts.
- [ ] 3. Start: work Focus turns on within a second or two (note any permission prompt). Pause: off. Resume: on. Finish: off.
- [ ] 4. Start one key, press another while it runs: Focus stays on, no flicker. Pause, press a third key: Focus comes back on. Hold to cancel: off.
- [ ] 5. **On end** = **Leave Focus as it is**: start and finish; Focus turns on and stays on. Turn it off by hand.
- [ ] 6. Start a timer, switch to Do Not Disturb by hand. At the finish **On end** runs anyway. Note whether it turned Do Not Disturb off.
- [ ] 7. Rename the Focus On shortcut and start a timer: the countdown runs, the key flashes an alert, the Property Inspector shows `No shortcut named …`, the picker shows "(not found)". Rename it back.
- [ ] 8. Uncheck switching mid-timer: when it ends, Focus is left on.
- [ ] 9. Work Focus on, notification enabled, **On end** = **Leave Focus as it is**: note whether the banner appears; the sound plays.
- [ ] 10. If **Share across devices** is on, confirm the iPhone follows and decide whether that's acceptable.
- [ ] 11. Start a Break key on its own: Focus doesn't change at start, pause, resume or finish. Start a work key (Focus on), then press Break: **On end** runs and Focus turns off. Press a work key again: Focus comes back on.
- [ ] 12. Log shows `Focus shortcut … failed` only where expected.

## 6. Recovery

Sound on. Focus switching on for item 11 only.

- [ ] 1. **Sleep through completion.** Start 1 min, sleep 3 min, wake: **0** within a second or two, one alert.
- [ ] 2. **Sleep mid-session.** Start 5 min, sleep 2 min, wake: shows **3**, finishes on time with one alert.
- [ ] 3. **Repeated wake.** Start 1 min, sleep/wake three times across the completion: one alert total.
- [ ] 4. **Quit mid-session.** Start 5 min, wait 1, quit Stream Deck, wait 2, reopen: shows **2**, keeps the original end, one alert. Repeat paused: comes back paused with the same minutes.
- [ ] 5. **Quit through completion.** Start 1 min, quit, wait 2, reopen: **0** and one alert shortly after launch. Quit and reopen twice more: no more alerts, still **0**.
- [ ] 6. **Restart macOS** mid-session and through a completion: same as 4 and 5 once Stream Deck runs.
- [ ] 7. **Unplug/replug the Neo** mid-session and through a completion: the alert plays on time while unplugged; after replugging keys show current minutes or **0**.
- [ ] 8. **Page/profile switch** until the timer finishes, then back: alert on time, key shows **0**.
- [ ] 9. **Deleted key.** Start 1 min, delete the key: the alert still plays once. Another timer key starts normally.
- [ ] 10. **Key identity.** Start a key, quit and reopen: the same physical key continues. If another key or none shows it, that's a blocker (the saved key id isn't stable).
- [ ] 11. **Focus recovery.** Quit mid-session and reopen: **On start** doesn't run again; at finish **On end** runs once. Quit (or sleep) through completion and reopen/wake: **On end** runs once; more relaunches or wakes run nothing. Change Focus by hand, then sleep through completion: on wake **On end** still runs once (expected).
- [ ] 12. **Bad state file.** Quit, replace `state.json` with the text `garbage`, reopen: log warns `Saved timer state is not valid JSON; moved it to …/state.unsupported-….json and starting clean`; keys idle; a timer starts normally. Delete the backup.

## 7. Uninstall

- [ ] 1. Stream Deck › Preferences (or Settings) › Plugins › Focus Keys › uninstall (wording may vary). The category and keys' action disappear; no errors in Stream Deck's log.
- [ ] 2. Delete `~/Library/Application Support/com.austinzani.focus-keys/`. Nothing else of the plugin remains apart from your shortcuts.
- [ ] 3. Back to development: `npx streamdeck dev`, `npm run link`, `npm run restart`.

## Owner decisions to record

The full list is every **owner** and **asset** row in [MARKETPLACE.md](MARKETPLACE.md) › Requirement checklist. The main ones:

- [x] Name and UUID: Focus Keys / `com.austinzani.focus-keys` (2026-11-24). Still to do: a formal trademark search before creating the product.
- [ ] Price, and Marketplace type and tags.
- [x] Second action: Break added (2026-11-24).
- [ ] Approve the Maker Console app icon, thumbnail and gallery (captions, a photo or video of the Neo).
- [ ] AI disclosure wording for the submission.
- [ ] Public identity: Maker organization and handle, and the manifest `Author`.
- [x] Source license: MIT (2026-11-24).
- [x] Support URL and privacy statement: GitHub Issues and the user guide Privacy section (2026-11-24; live once the repo is public).

Product calls from this pass:

- [x] Notification helper (Developer ID signed and notarized) shows notifications as Focus Keys after installing the package: yes (2026-11-24).
- [x] Focus recovery rule (**On end** runs once after any gap, however long): kept, no cutoff (2026-11-24).

## Results

| Group | Pass / fail | Notes (blockers first) |
| --- | --- | --- |
| 1. Install | Partial pass | Packaged plugin installed and connected; both actions appear. Remaining clean-setup checks are unverified. |
| 2. Four-key timer | Partial pass | On a virtual test profile, start, pause, resume and cancel were logged; a one-minute timer completed on time. Four-key and Break checks remain. |
| 3. Appearance | Partial | One idle preset displayed its large number on the virtual device. Font, color and physical Neo checks remain. |
| 4. Alerts | Partial pass | One-minute completion logged one Glass alert and the owner heard a sound. Fixed missing executable permission in the package; after reinstalling and enabling macOS permission, the owner confirmed a Focus Keys notification from a timer. Remaining sound, notification-setting and cancellation cases are unverified. |
| 5a. Focus prototype | Skipped | Owner requested that Focus testing wait. |
| 5b. Plugin Focus | Skipped | Owner requested that Focus testing wait. |
| 6. Recovery | Not tested | Restart attempt was canceled; live recovery cases remain. |
| 7. Uninstall | Not tested | Plugin remains installed. |
