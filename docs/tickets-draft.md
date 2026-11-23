# Proposed implementation tickets

Draft: ticket titles, acceptance criteria, and dependencies require user review. The numbered blockers below describe real implementation dependencies, not issue identifiers.

## 1. Run a whole-minute countdown on one Neo key

**Blocked by:** None.

**What it delivers:** Install the new Mac plugin locally, place a preset action on the Neo, and press it to start a real five-minute countdown with a large, seconds-free number and visible running progress.

**Acceptance criteria**

- [ ] The plugin can be installed for local development and loaded by Stream Deck on macOS.
- [ ] An idle key displays 5; a press starts one timer and displays remaining whole minutes, rounded up.
- [ ] The running ring is visible, and the completed key displays 0.
- [ ] Behavior tests drive the plugin boundary using a controlled clock; an owner can verify the slice on the Neo.

## 2. Control one timer from configurable preset keys

**Blocked by:** 1.

**What it delivers:** Configure 5, 15, 30, and 60-minute keys and control one shared countdown by tapping, holding, or selecting a different preset.

**Acceptance criteria**

- [ ] Four independently configurable durations can be placed on keys and show their idle preset numbers.
- [ ] Tap active key to pause/resume, hold active or paused key to cancel and reset, and start again from 0 after completion.
- [ ] Selecting another preset replaces the current session without triggering a completion alert or an intermediate end transition.
- [ ] Paused progress is distinguishable and saved button durations survive normal plugin restart.
- [ ] Tests cover session transitions and all minute boundaries without real-time sleeps.

## 3. Personalize each timer button

**Blocked by:** 2.

**What it delivers:** Choose each button's color and one of five readable number fonts while keeping a clean dark idle look and clear running and paused states.

**Acceptance criteria**

- [ ] Each key exposes a color and a font choice; there are five font options and preferences persist.
- [ ] Large whole-minute numbers, active progress, paused progress, and completion are readable on the physical Neo for each option.
- [ ] Verify font licensing, available glyphs, and distribution; safe fallbacks render if a font isn't available.
- [ ] Appearance choices do not change timer state or its duration; validate rendering through observable output and hardware checks.

## 4. Hear and see a completion alert

**Blocked by:** 2.

**What it delivers:** Select or silence a completion sound and independently enable a macOS notification with editable text shared across the preset keys.

**Acceptance criteria**

- [ ] A timer reaching zero shows 0 and requests the selected sound once; silence is available.
- [ ] Notification enablement and text are configurable; notification and sound can be enabled independently without double playback.
- [ ] The settings explain notification authorization and a denied or unavailable notification does not break the timer.
- [ ] End-to-end checks cover completion versus cancellation/replacement, plus sound and permission behavior on the real Mac.

## 5. Switch Focus for timer sessions

**Blocked by:** 2.

**What it delivers:** Optionally enter a configured Focus for a timer and restore the previous one on pause, cancel, or completion where supported, with a clear configured fallback otherwise.

**Acceptance criteria**

- [ ] First prove the supported Shortcuts path on macOS, including Focus identity, no active Focus, switching and restoration, manual/scheduled changes, and permission/setup needs. Record limits and do not rely on private APIs.
- [ ] When enabled, start/resume applies the configured Focus; pause/cancel/completion restores the previous Focus only if proved reliable, otherwise applies the explicitly configured fallback.
- [ ] Manual changes are preserved when they can be reliably detected; otherwise the fallback limitation is clearly stated. Replacing a running preset does not spuriously end the Focus session.
- [ ] Failed/unavailable integration leaves the countdown usable and gives actionable setup feedback; toggling Focus integration off suppresses Focus changes.
- [ ] Test real Mac Focus and notification interactions, including cross-device sync disclosure and whether a Focus suppresses completion banners.

## 6. Recover a running timer and missed completion

**Blocked by:** 2, 4, 5.

**What it delivers:** A session keeps the correct remaining time through sleep, wake, Stream Deck restart, navigation, and reconnection; a missed completion is shown and delivered once on return.

**Acceptance criteria**

- [ ] Persist session deadline, pause state, and delivery bookkeeping; elapsed sleep/restart time counts down from the original deadline.
- [ ] On wake, relaunch, appearance, and reconnect, the key reflects current state; an expired session displays 0 and delivers its configured alert once.
- [ ] No duplicated sound, notification, or Focus transitions follow repeated wake/restart events; integration errors don't erase the timer.
- [ ] Recovery avoids unexpectedly overriding a manual Focus change when reliably detectable and explains fallback limits otherwise.
- [ ] Automated lifecycle tests use controlled time; a real-device checklist covers sleep, quit, restart, and reconnect.

## 7. Validate direct installation and prepare Marketplace release

**Blocked by:** 3, 4, 5, 6.

**What it delivers:** The owner can install and exercise a complete Mac plugin on the Neo, with clear setup and troubleshooting, and the plugin is prepared for Marketplace publication after testing.

**Acceptance criteria**

- [ ] Package, validate, and install a direct-distribution plugin on a clean Mac/Stream Deck setup; test the entire four-key experience on the Neo.
- [ ] Document settings, sound and notifications, Focus permissions/Shortcuts setup, Focus sync, expected behavior during sleep and restart, and supported limitations.
- [ ] Complete the owner's real-device acceptance pass and fix release-blocking problems before Marketplace submission.
- [ ] Prepare listing, imagery, name, licensing, and maker requirements; submit after successful testing and accurately report the review/publication state.
