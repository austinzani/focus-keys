# Spec: Stream Deck Neo Pomodoro Timer

Approved for implementation planning. The product name is provisional. The Linear spec is the tracker source of truth.

## Problem Statement

On a Stream Deck Neo connected to a Mac, existing timers show distracting seconds, repeated clock icons, or complex interfaces. The user wants to press a duration and see at a glance how many whole minutes remain, with a clear running indicator and an optional Mac alert. Changing Focus by hand around each session adds friction.

## Solution

Provide a Mac-only Stream Deck plugin that presents four configurable timer buttons, initially 5, 15, 30, and 60 minutes. Each shows one large number; the active key counts down whole minutes with a colored progress ring. The user can customize the duration, color and number font, choose sounds and notification text, and opt into Focus switching. The timer remains correct across sleep and restart, recovers a missed completion once, and works without a separate always-visible app. Test on the owner's Neo before preparing Marketplace publication.

## User Stories

1. As a Mac user, I want to install the plugin directly, so that I can try it before Marketplace publication.
2. As a Neo user, I want four visible presets of 5, 15, 30, and 60 minutes, so that common sessions start quickly.
3. As a user, I want to change each preset's duration, so that the buttons fit my routine.
4. As a user, I want each idle key to show one large number, so that I can distinguish durations at a glance.
5. As a user, I want no seconds displayed, so that the display feels calm and readable.
6. As a user, I want the active key to show remaining whole minutes, so that I can see the countdown.
7. As a user, I want partial minutes rounded up, so that five stays visible until four minutes remain and zero appears only when time is up.
8. As a user, I want a colored ring while running, so that I know a timer is active and can see progress.
9. As a user, I want a muted ring when paused, so that paused and running states are distinguishable.
10. As a user, I want a dark, uncluttered default appearance, so that the numbers are easy to read.
11. As a user, I want each button to have its own color, so that I can distinguish durations.
12. As a user, I want five number-font options, so that the display matches my taste.
13. As a user, I want each button's appearance saved, so that it survives restarts.
14. As a user, I want to press a preset to start it, so that timing takes one action.
15. As a user, I want only one active timer, so that I always know which countdown matters.
16. As a user, I want selecting another preset to replace the current timer without a false completion alert, so that switching durations is predictable.
17. As a user, I want to tap a running timer to pause it, so that I can interrupt a session.
18. As a user, I want to tap the paused timer to resume it, so that I can finish the remaining time.
19. As a user, I want to hold the active or paused key to cancel and reset it, so that I can abandon a session.
20. As a user, I want a finished timer to show zero until I start again, so that completion remains visible.
21. As a user, I want a press of a finished timer to start a fresh session, so that repetition is easy.
22. As a user, I want a completion sound that I can select or disable, so that I can hear when time is up.
23. As a user, I want an optional macOS notification, so that I can notice completion while looking elsewhere.
24. As a user, I want to customize the notification text, so that the reminder sounds like me.
25. As a user, I want sound and notifications controlled separately, so that either can be disabled.
26. As a user, I want shared alert settings across presets, so that I don't configure them repeatedly.
27. As a user, I want optional Focus switching, so that starting a timer can reduce distractions.
28. As a user, I want a configured Focus on start and resume, so that my work environment is consistent.
29. As a user, I want my previous Focus restored on pause, cancel, or completion when reliably supported, so that a timer doesn't permanently change my environment.
30. As a user, I want to choose the Focus to apply afterward if restoration is unavailable, so that the behavior is explicit.
31. As a user, I want manual Focus changes respected when reliably detectable, so that the timer doesn't undo my choice.
32. As a user, I want Focus integration to be optional, so that a countdown works without it.
33. As a user, I want permission failures and setup requirements explained, so that unavailable integrations do not silently fail.
34. As a user, I want time spent asleep to count, so that the countdown reflects elapsed time.
35. As a user, I want a missed completion handled once after wake or restart, so that I don't miss it or get duplicate alerts.
36. As a user, I want a running timer recovered after Stream Deck or macOS restarts, so that closing the app doesn't reset my session.
37. As a user, I want the correct state restored when I return to a profile or reconnect the Neo, so that the display is current.
38. As a user, I want the timer to remain usable without internet, an account, or a remote service, so that my focus sessions stay local.
39. As the owner, I want the full experience tested on my Mac and Neo before publication, so that the shipped plugin is dependable.
40. As a future user, I want a Marketplace-ready installation and setup guide, so that I can install and configure the plugin myself.

## Implementation Decisions

- This is a new, standalone repository and product. Spritz has no relevant implementation or domain vocabulary to reuse; do not couple the plugin to Spritz.
- Use Elgato's supported Stream Deck SDK and local development/packaging workflow. Target macOS; do not build Windows support. The working project name is not a final product name.
- Expose one configurable preset action, installed multiple times, coordinating one shared session across actions. Actions render a whole-minute integer plus a ring. Avoid SDK title/image overrides that prevent live rendering; validate all five font choices on real hardware and with licensing/distribution requirements.
- Model session state and its visible results at a single application boundary: preset presses and holds, clock changes, persisted session, settings, and integration outcomes enter the coordinator; key renderings and requested system effects leave it. Use controllable clock, persistence, and macOS/SDK adapters at this boundary. Avoid adding a separate application merely for the core countdown; use a properly packaged helper only if platform integrations require it.
- Track an absolute end time while running and frozen remaining duration while paused. Compute displayed minutes by rounding positive remaining time upward. A duration change applies predictably without producing spurious completion; exact editing behavior must be specified during implementation rather than assumed.
- Persist enough session and completion-delivery state to restore after process or system restart and deliver missed alerts at most once. Refresh on appearance, wake, reconnection, and restart. A Mac cannot be assumed to play a sound while asleep or while the plugin is stopped; deliver the missed event after operation resumes.
- Shared preferences cover optional notification, editable notification text, selectable sound including silence, and optional Focus integration. Button-specific preferences cover duration and color; offer five fonts and make the font setting available for each button. Exact font assets and sound choices are design decisions to validate.
- Prototype supported macOS Shortcuts integration first: determine whether Get Current Focus returns a restorable named identity, how no active Focus is represented, how the selected Focus can be activated, whether manual/scheduled changes can be detected, and how invocation/permissions work. Do not use undocumented/private system APIs. If reliable restoration or change detection is unavailable, expose the configured end Focus fallback and accurately explain its behavior; never silently claim restoration or manual-change protection.
- On pause, cancellation or completion apply the agreed end-of-session Focus behavior; on resume apply the start Focus. Replacing a timer stays within one focus session and does not perform a spurious end transition. Avoid overriding a user-selected Focus when detectable. Focus changes can synchronize across Apple devices.
- Notifications require macOS authorization and can be delayed or suppressed by Focus. Test app/helper identity and permission presentation. Play audio independently when enabled; prevent double sounds if notification audio and explicit playback overlap. The user can configure both independently.
- Neo Infobar support and automatic work/break cycling are follow-up features. Prepare direct installation and a Marketplace submission after owner testing; do not represent approval or publication as completed until actually verified.

## Testing Decisions

- Test externally visible behavior at the plugin's application boundary, rather than checking internal implementation details. Drive key actions, controlled clock changes, persisted state, and adapter outcomes; assert displays, configuration, session transitions, and system-effect requests.
- Cover minute boundaries including 5:00, 4:59, exactly 4:00 and completion, plus full progress, pause/resume, hold/cancel, new-preset replacement, finished restart, independent settings, unavailable Focus, and disabled alerts.
- Cover sleep, wake, process restart, expired-on-restart, repeated startup and duplicate-event delivery, page/profile changes, reconnect, and user/system clock changes with controlled time and persistence. Establish and document clock-change policy during implementation.
- Test notification denial, Focus/Shortcuts failure, prior-mode capture including no Focus, manual Focus changes where observable, and the explicit fallback. Do not assume automation permissions or native notification identities work until exercised.
- Verify all fonts, colors, preset changes, and live readability on a real Mac and Neo, and test alarm audibility, optional notification, Focus transitions, sleep/wake, and recovery. Test the packaged direct installation on a clean setup before Marketplace submission.
- There is no relevant plugin test prior art in Spritz. Establish the new project's own behavior-focused tests and a documented real-device checklist.

## Out of Scope

- Windows support, automatic Pomodoro work/break cycles, multi-device sync, accounts, cloud services, analytics, and a separate full-featured desktop app.
- Neo Infobar implementation in the first release, although it may follow later.
- Direct, unsupported macOS Focus access; promising that a banner breaks through Focus or an alarm sounds while the Mac is asleep.
- Publishing before owner testing or implying Marketplace approval is automatic.

## Further Notes

- [Elgato key API](https://docs.elgato.com/streamdeck/sdk/guides/keys/), [plugin environment](https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment/), and [packaging](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/).
- [Apple Shortcuts release notes](https://support.apple.com/en-us/101583), [running shortcuts](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac), and [notification authorization](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications).
- Focus restoration, mode selection, manual-change detection, notification identity, and audio packaging are feasibility questions. The supported fallback is required; record findings and do not promise unverified capabilities.
