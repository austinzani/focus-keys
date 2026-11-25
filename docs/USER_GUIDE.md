# Focus Keys user guide

Focus Keys turns Stream Deck keys into whole-minute countdown timers. Each key is one preset (for example 5, 15, 30 or 60 minutes). All keys share one timer: starting one key replaces whatever another key was running. The key shows the minutes left and a ring or background sweep for progress. It never shows seconds.

## Requirements

- macOS 12 or later. Mac only.
- Stream Deck app 7.1 or later.
- Designed for the Stream Deck Neo's keys. Other models with keys should work but are untested. The Neo Infobar isn't used.

## Install

1. Double-click `com.austinzani.focus-keys.streamDeckPlugin`.
2. Stream Deck asks whether to install the plugin. Confirm.
3. The **Focus Keys** category appears in the Stream Deck app's action list, with two actions: **Timer Preset** for work sessions and **Break** for breaks.

Updating works the same way: double-click the newer file. Keys and their settings belong to your Stream Deck profile, and the timer's state is stored outside the plugin folder, so both should carry over.

## Set up four keys

1. Drag **Timer Preset** onto four keys. Each new key shows a large tomato-colored **5**.
2. Select each key and set **Minutes** in the Property Inspector, for example **5**, **15**, **30** and **60**. The field saves when you press Enter, click away, or close the Property Inspector.
3. Optionally give each key its own **Style**, colors and **Font**.
4. Optionally drag **Break** onto a fifth key for breaks. It starts teal and works like a preset key, but never turns Focus on (see below).
5. Optionally set up a completion sound or notification and Focus switching (below). Those settings are shared by all timer keys.

## Using the timer

| Action | Result |
| --- | --- |
| Tap an idle or finished key | Starts a timer for that key's minutes. |
| Tap the running key | Pauses. The number and progress freeze; a ring turns a muted shade. |
| Tap the paused key | Resumes from where it paused. |
| Tap another key while a timer is running or paused | Replaces it. The old key goes back to its idle number. No alert plays for the replaced timer. |
| Hold the running or paused key for about half a second (600 ms) | Cancels while your finger is still down. The key goes back to its idle number. No alert. |
| Hold a finished key (showing **0**) | Clears it back to its idle number. |
| Hold any other key | Nothing. A hold never starts a timer. |

Taps count when you release the key, so a hold is never also a tap. When a timer reaches zero its key shows **0** until you tap it (starts again) or hold it (clears it). A finished ring disappears; a finished sweep fills the background.

The number counts whole minutes and changes when that many full minutes remain: a 5-minute timer shows **5** until four minutes are left, then **4**.

### Minutes

- Whole minutes from 1 to 180. Three-digit numbers are drawn smaller to fit.
- A new key starts at 5.
- An unusable entry (empty, 0, 200, a decimal) is ignored and the key keeps its previous value. When you close the Property Inspector, the field is reset to the value the key is using.
- Changing an idle or finished key's minutes takes effect at once. Changing the running or paused key's minutes doesn't affect the current timer; the new value applies the next time that key starts.

## Appearance

Each key has its own **Style**, colors and **Font**. Changes redraw only that key and never affect a running timer.

- **Ring** (default): choose a background, number color and ring color independently; the ring shrinks as time passes. The number keeps its color when running. A paused ring is muted. Existing keys keep their chosen number and ring color and background.
- **Sweep left to right** or **Sweep top to bottom**: choose the starting background, number and sweep colors independently. The number keeps its chosen color throughout. At completion the background is fully swept. A paused sweep stays frozen.
- The background color is shared by all three styles for that key. Colors are shown as chosen, so pick a number and background with enough contrast to read comfortably.
- Fonts: **Inter** (default), **Nunito**, **Oswald**, **JetBrains Mono**, **Bitter**. The digits are built into the plugin, so they look the same whatever fonts your Mac has.
- The action has no title field. If a key shows a picture instead of the number, it has a custom image set in the Stream Deck app; clear it.

## Alerts

The **Alerts — shared by all timer keys** section at the bottom of every timer key's Property Inspector controls what happens when a timer reaches zero. Only finishing alerts; pausing, cancelling and replacing never do. A timer that finishes while its key is on another page or profile, or while the Property Inspector is closed, still alerts on time. Each timer alerts at most once (one rare exception under Sleep, restart and reconnecting).

| Setting | Default | Notes |
| --- | --- | --- |
| Sound | Glass | Glass, Hero, Ping, Submarine, Funk, Blow, Purr, Tink, or **None (silent)**. These are the Mac's built-in sounds. |
| Sound length | Short | **Short** plays the sound once. **Long** plays it five times with a one-second pause between plays. This setting is shared by all timer keys. |
| Notification | Off | **Show a macOS notification**: a banner titled "Focus Keys". |
| Text | `Time's up: {minutes}-minute timer finished.` | Used when the field is empty. `{minutes}` becomes the timer's length. Up to 200 characters. |

The sound follows your Mac's output volume and mute. It doesn't depend on notification permission or Focus.

About notifications:

- They come from **Focus Keys**, shown by a small helper app inside the plugin (no window, no Dock icon). To allow, block or restyle them, use **System Settings › Notifications › Focus Keys**.
- The first notification makes macOS ask whether Focus Keys can send notifications. Allow it. That first banner may not show until you answer.
- If you turn Focus Keys notifications off, the plugin respects that and shows nothing (the sound still plays).
- If the helper can't run (for example it was removed or macOS blocks it), the banner comes from **Script Editor** instead, through AppleScript. Its settings are under **System Settings › Notifications › Script Editor**.
- A Focus can hide the banner unless Focus Keys is allowed in that Focus. Notification Center may still list it. The sound plays either way.
- The banner never adds its own sound, so you only hear the sound you chose.

## Focus switching (optional)

Off by default. macOS doesn't let plugins set Focus directly, so Focus Keys runs shortcuts that you make in the Shortcuts app. Your shortcut does the switching with the **Set Focus** action.

### Setup

1. In the Shortcuts app, make a shortcut (for example "Work Focus On") with one **Set Focus** action that turns your work Focus **On**, until **Turned Off**.
2. Optionally make a second shortcut (for example "Work Focus Off") with **Set Focus** turning Focus **Off**.
3. Open any timer key's Property Inspector. In **Focus — shared by all timer keys**, check **Switch Focus with the timer**. Under **On start** pick the first shortcut. Under **On end** pick the second, or **Leave Focus as it is**. Use the refresh button if a new shortcut isn't listed. A chosen shortcut that was renamed or deleted shows "(not found)".
4. The first run may ask for permission, for example to let Shortcuts change Focus or to let Stream Deck run shortcuts. Allow it. Until then the shortcut fails and the key shows a brief alert triangle.

### When the shortcuts run

| Timer event | Focus |
| --- | --- |
| Start | Runs **On start** |
| Pause, cancel (hold), finish | Runs **On end** (or nothing, with **Leave Focus as it is**) |
| Resume | Runs **On start** |
| Another key replaces a running timer | Nothing: Focus stays on, no off-then-on flicker |
| Another key replaces a paused timer | Runs **On start** (the pause already ran **On end**) |
| A **Break** key starts, pauses, resumes or finishes | Never runs **On start**. Taking over from a running work timer runs **On end** |
| Switching unchecked | Nothing ever runs |

Shortcuts run in the background, one at a time, and never delay the countdown. A shortcut that hasn't finished after 30 seconds is stopped.

### What it doesn't do

- **Your previous Focus is not restored.** At the end the plugin runs your **On end** shortcut, or leaves Focus alone. It doesn't remember which Focus you had before.
- **Changes made by hand or by a Focus schedule aren't detected.** If Focus changes during a timer, **On end** still runs when the timer pauses or finishes and may undo the change. Whether a "Focus off" shortcut also turns off a different Focus you picked by hand hasn't been tested yet. Choose **Leave Focus as it is** to avoid this.
- **On end needs On start.** **On end** runs only after this timer's **On start** ran successfully (or was stopped at the 30-second limit, since it may already have changed Focus). It doesn't run if **On start** is **None**, switching was off when the timer started, the start shortcut was missing or failed, or the Focus settings couldn't be read when the timer started. So it never turns off a Focus the timer didn't turn on.
- **After sleep or restart, On end still runs once.** If the plugin turned Focus on and that timer finished (or was stopped) while the Mac slept or Stream Deck was closed, **On end** runs once when the plugin is running again, however long ago that was. Otherwise your work Focus could stay on with no timer running.
- **Focus can sync to your other devices.** If **Share across devices** is on in System Settings › Focus, these changes also apply to your iPhone, iPad and other Macs.
- Unchecking switching during a timer means **On end** won't run for it.
- A shortcut whose name starts or ends with spaces can't be chosen; rename it.

When a shortcut can't run (missing or renamed, an error inside it, permission denied, 30-second timeout), the timer carries on, the timer's key shows Stream Deck's alert triangle briefly, and the Focus section of the Property Inspector shows the latest problem, such as `No shortcut named "Work Focus On" in the Shortcuts app`, until a shortcut next runs successfully or you change the Focus settings. On a Mac set to a language other than English, a missing shortcut may be reported with the `shortcuts` command's own error text instead.

## Sleep, restart and reconnecting

The timer counts real time, so time the Mac spends asleep or Stream Deck spends closed still counts.

- **Restart** (plugin, Stream Deck or Mac): a running timer keeps counting from its original end time; a paused one comes back paused with the same time left.
- **Finished while asleep or closed:** the key shows **0** and the alert plays once as soon as the plugin is running again (on wake, or after Stream Deck starts). A Mac can't play a sound while asleep.
- **Alerts and Focus switches aren't repeated** by repeated wakes or restarts. The plugin records each one before doing it, so a crash or quit between recording an alert and playing it skips that alert rather than playing it twice. One rare exception: if saving that record fails or takes over 2 seconds, the alert or shortcut still runs, and could run again after a quit, crash or restart that comes before the next successful save. The plugin log shows the failed save.
- **Changing pages or profiles** doesn't stop the timer. The key shows the current state when it's visible again.
- **Unplugging the Neo** doesn't stop the timer. A timer that finishes while it's unplugged alerts on time; reconnecting redraws the keys.
- **Deleting a running key doesn't stop its timer.** Stream Deck reports a deleted key the same way as a key on another page, so the timer finishes and alerts once. To stop it for good, hold the key to cancel before deleting it. Pressing any other timer key starts a fresh timer as usual. A paused timer on a deleted key stays paused, unseen, until another key starts.
- **Changing the Mac's clock:** setting it forward counts as elapsed time; setting it back extends the timer, but the key never shows more than its preset.

## Saved state

The plugin saves the current timer to `~/Library/Application Support/com.austinzani.focus-keys/state.json`. It holds only the current timer (which key, its length, its end time or time left), the last timer id, which timer last alerted, and which timer turned Focus on. Key durations, colors, fonts and the alert and Focus settings are stored by Stream Deck with your profile.

To reset: quit Stream Deck, delete that folder, reopen Stream Deck. All keys start idle.

## Troubleshooting

- **The key shows a picture, not a number.** It has a custom image set in the Stream Deck app. Clear it.
- **The key flashes a warning triangle when a timer starts or stops.** A Focus shortcut couldn't run. Open the key's Property Inspector; the Focus section shows the problem.
- **No banner appears.** Check System Settings › Notifications › Focus Keys (or Script Editor, if the log says `showing the banner through Script Editor instead`), and whether a Focus is hiding it. The sound plays regardless.
- **No sound.** Check the Sound setting isn't **None (silent)** and the Mac's volume and mute.
- **Log warning `moved it to …state.unsupported-….json`.** The saved state couldn't be used, so it was set aside under that name and the timer started idle. Nothing else is needed; delete the backup when you like.
- **Log error `won't be saved this run` at startup.** The state file couldn't be read and couldn't be moved aside, usually a permissions problem on the folder above. The timer works but won't survive a restart. Quit Stream Deck, make the folder writable (or move the file out), and reopen.
- **Logs** are in `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.austinzani.focus-keys.sdPlugin/logs/`. Stream Deck's own log is `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`.

## Limitations

- Mac only.
- Whole minutes only, 1 to 180. No seconds are shown.
- One timer at a time across all keys.
- No automatic work/break cycles; each key is one preset you start yourself.
- The Neo Infobar isn't used.
- Focus switching needs your own shortcuts, doesn't restore your previous Focus, and doesn't notice manual Focus changes.
- If the notification helper can't run, notifications appear as Script Editor's.
- Nothing can play while the Mac is asleep; a missed alert plays once on wake.

## Privacy

Everything stays on your Mac. The plugin makes no internet connections and collects no analytics; its only connection is the local one to the Stream Deck app. It writes only its state folder (`state.json`, a temporary file while saving, and a `state.unsupported-….json` backup if a saved file can't be used) and its logs. To do its job it runs three built-in macOS programs directly (no shell):

- `/usr/bin/afplay` to play a sound from `/System/Library/Sounds`.
- `/usr/bin/osascript` to show a notification with your text.
- `/usr/bin/shortcuts` to list your shortcuts and run the ones you chose for Focus.

## Uninstall

1. In the Stream Deck app, open Preferences (Settings in some versions) › **Plugins**, select **Focus Keys**, and uninstall it. The exact wording may vary by app version.
2. To remove all data, delete `~/Library/Application Support/com.austinzani.focus-keys/`.
3. Optionally delete the Focus shortcuts you made for it. Focus Keys may stay listed in System Settings › Notifications until macOS tidies it up.
