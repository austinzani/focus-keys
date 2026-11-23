# Stream Deck Neo Pomodoro Plugin Research

Research date: November 23, 2026. This is a feasibility note; the draft spec records current decisions.

## Working product scope

This summarizes the discussion; the spec and implementation tickets remain subject to review.

- Mac-only Stream Deck plugin, initially installed and tested on the owner's Neo; prepare for Marketplace publication after successful testing.
- Four configurable duration actions, initially 5, 15, 30, and 60 minutes. Only one timer runs at a time. Starting another duration replaces the current timer without a completion alert.
- A large whole-minute number on each key. Round remaining time up: a five-minute timer displays `5` until four minutes remain, and `0` only at completion. A colored ring indicates progress while running and appears muted when paused.
- Each button has configurable color and a choice of five number fonts. The precise font choices and rendering compatibility remain to be validated.
- Tap the active key to pause or resume; hold it to cancel and reset. Pressing a finished key starts a fresh timer.
- On completion, display `0` and optionally play one sound and show a notification with user-editable text. Sound and notifications are separately configurable.
- Optional Focus integration: choose what to activate on start/resume. On pause, cancel, or completion, restore the prior Focus if a supported, reliable method proves feasible; otherwise use an explicitly configured fallback. Respect manual Focus changes where reliably detectable. The exact Shortcuts integration and Focus-selection UI require a prototype.
- Track an absolute deadline. Account for time spent asleep or while Stream Deck is stopped; on wake or restart, recalculate the countdown and handle a missed completion once. Test permission, sound, notification, and Focus recovery behavior on the actual Mac and Neo.
- First release focuses on the four keys. A Neo Infobar countdown is a possible follow-up.

## Feasibility

A small, local, macOS-only Stream Deck plugin can implement the requested timer without a separate Mac app. Elgato's plugin architecture runs the plugin's application logic in Node.js, uses an HTML property inspector for settings, and relies on the Stream Deck app for device communication. The manifest declares supported operating systems and minimum versions. [Elgato: plugin environment](https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment/), [manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/)

- **Keys:** Key-down and key-up events enable tap and hold interactions. A plugin can dynamically render an SVG image on its own key: one large integer and a colored ring are therefore practical. A user's custom key image or title takes precedence over the plugin's runtime image or title; the setup should leave those overrides unset. [Elgato: keys](https://docs.elgato.com/streamdeck/sdk/guides/keys/)
- **Neo lower display:** An optional Neo Infobar action supports dynamic text/images in a 232 × 50-pixel layout, but is display-only and does not receive touch events. It requires Stream Deck 7.6 or later. The physical keys can control a shared timer displayed there; sharing is an implementation design, not an automatic SDK behavior. [Elgato: Neo Infobar](https://docs.elgato.com/streamdeck/sdk/guides/neo-infobar/)
- **Settings:** A property inspector can configure each action, such as a preset duration and color; action-specific and plugin-wide settings can be saved by the SDK. An optional preset Neo profile is supported. [Elgato: property inspectors](https://docs.elgato.com/streamdeck/sdk/guides/ui/), [settings](https://docs.elgato.com/streamdeck/sdk/guides/settings/), [manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/)
- **Audio:** Completion sounds can be implemented locally; Apple documents `NSSound` for playing local files or named system sounds. This would require a suitable macOS audio bridge or helper from a Node-based plugin; exactly how to package and invoke it is an implementation spike, not a documented built-in Stream Deck timer API. Elgato supports embedding user-selected sound files in action resources for portable exported profiles, though bundled choices would be simpler initially. [Apple: NSSound](https://developer.apple.com/documentation/appkit/nssound), [Elgato: embedded resources](https://docs.elgato.com/streamdeck/sdk/guides/resources/)
- **System hooks:** The SDK provides an event when the Mac wakes and can report launch/termination of apps registered in the plugin manifest. Those are specific capabilities, not blanket access to macOS Focus, Calendar, or notifications; each additional integration needs its own API and permission investigation. [Elgato: system](https://docs.elgato.com/streamdeck/sdk/guides/system/), [app monitoring](https://docs.elgato.com/streamdeck/sdk/guides/app-monitoring/)

## Proposed small implementation

1. A single timer action with a configurable duration; place it four times for 5, 15, 30, and 60 minutes. Render the duration as one large integer when idle and remaining whole minutes when running. Ceiling keeps a five-minute timer at `5` until exactly four minutes remain, and avoids displaying `0` before completion.
2. Store an absolute deadline rather than decrementing a counter at fixed intervals. Use a ring or color for the running state and update the display only when the displayed minute or state changes. These are implementation recommendations, not automatic SDK guarantees.
3. A shared timer coordinates all four preset actions. The lower display is a possible later addition.
4. Handle `onWillAppear` after navigating back and `onSystemDidWakeUp`; restore settings/state and recalculate remaining time. Test behavior on sleep, wake, page changes, app/plugin restart, disconnect, and completion during sleep. A software plugin cannot be assumed to sound while the Mac is asleep or Stream Deck is not running. Decide whether a missed alarm should play upon wake or restart. [Elgato: system wake](https://docs.elgato.com/streamdeck/sdk/guides/system/), [keys lifecycle events](https://docs.elgato.com/streamdeck/sdk/guides/keys/)

## Development and distribution

Elgato's current getting-started guide specifies Node.js 24+, Stream Deck 7.1+, its CLI, and a Stream Deck device; the CLI scaffolds and locally links a plugin for development. A build that includes an Infobar action must target Stream Deck 7.6+. The CLI can validate and package a `.streamDeckPlugin` for direct distribution; Marketplace publication is optional and adds a Maker Console review process. [Elgato: getting started](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/), [distribution](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/)

## Unverified details

- Whether an unsigned or signed macOS audio helper is needed and the simplest playback approach under direct install or Marketplace packaging.
- The behavior of alarms when every plugin action is off-screen, the device disconnects, Stream Deck quits, the Mac sleeps, or its system clock changes. Test on the actual Neo before making reliability claims.
- How the lower display should behave if implemented later.
- The chosen plugin's user-facing name and exact font, color, and sound choices.

## Focus and notifications research

- **Shortcuts is a promising supported route, including for possible restoration.** Apple's macOS 13 Shortcuts release notes list `Get Current Focus` for checking Focus status, and Apple's command-line guide documents running a shortcut by name and receiving text or file output. An initial prototype can call user-configured Shortcuts from the plugin at timer boundaries. The evidence does **not** establish whether the action returns a stable identity that can be saved and later fed into a Set Focus action on the target Mac, or how the no-Focus state behaves; test those rather than assuming restoration works or is impossible. [Apple: Shortcuts release notes](https://support.apple.com/en-us/101583), [Apple: run shortcuts from the command line](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac)
- **The native status API is narrower than a named-mode API.** `INFocusStatusCenter` requires authorization and exposes `INFocusStatus.isFocused`, documented as the user's preference for receiving communication notifications. Its documented properties do not identify the active Focus by name. That does not establish the capabilities of the separate Shortcuts action above. [Apple: INFocusStatusCenter](https://developer.apple.com/documentation/intents/infocusstatuscenter), [Apple: INFocusStatus](https://developer.apple.com/documentation/intents/infocusstatus)
- **Focus filters are app integration, not a verified Focus switch.** `SetFocusFilterIntent` lets an app adapt to Focus changes through a filter configured for that app. Apple's documentation does not describe it as an API for selecting a system Focus or enumerating the user's modes. [Apple: Focus](https://developer.apple.com/documentation/appintents/focus/), [Apple: defining a Focus filter](https://developer.apple.com/documentation/appintents/defining-your-app-s-focus-filter)
- **Notifications:** `UNUserNotificationCenter` supports local notification content and requires user authorization for alerts and sounds. The system may suppress or delay notifications during Focus; notification permission or display does not guarantee a banner will appear. The implementation must test the process/bundle identity needed for a Node plugin or packaged native helper and how notification authorization is exposed. [Apple: asking notification permission](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications), [Apple: scheduling local notifications](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app), [Apple: configure Focus notification allowances](https://support.apple.com/guide/mac-help/mchl613dc43f/mac)
- **Open prototype questions:** Confirm selection of the user's named Focus in Shortcuts on macOS, returning the current mode's name or stable identity including when none is active, restoring it after a pause or completion, and respecting a manual or scheduled Focus change during the timer. Verify Shortcuts setup, authorization prompts, app distribution and locked/sleeping Mac behavior on the real machine. Avoid relying on private macOS APIs or assuming the plugin can enumerate Focus modes directly.
