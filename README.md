# Focus Keys

Focus Keys is a Mac-only Stream Deck plugin for whole-minute countdowns. Put a timer on a key, press it to focus, and see the minutes remaining without watching seconds. It is designed for the Stream Deck Neo; other Stream Deck models with keys should work but have not been tested.

## Features

- **Your presets:** Add a Timer Preset action for each duration you want, from 1 to 180 minutes. For example, set four keys to 5, 15, 30 and 60 minutes. All keys share one active timer.
- **Three visual styles:** Choose a shrinking ring, a left-to-right sweep or a top-to-bottom sweep. Each key has its own colors and one of five number fonts. Sweeps show a small play symbol while running; paused keys dim and show a pause symbol.
- **Simple controls:** Tap to start, pause or resume. Hold for about half a second to cancel. Pressing another preset replaces the current timer.
- **Breaks:** The separate Break action shares the timer but never turns Focus on.
- **Alerts:** Choose a macOS sound, silence it, or select a longer alert that repeats the sound five times. Optionally show a macOS notification with custom text. Alert settings are shared across keys.
- **Optional Focus switching:** Run your own Apple Shortcuts when a work timer starts, pauses, resumes or ends. Previous Focus is not automatically restored; manual Focus changes are not detected.
- **Recovery:** The timer tracks its deadline across sleep and Stream Deck restarts. A missed completion can alert when the plugin resumes. Real-device recovery checks are still in progress.

## Requirements and installation

- macOS 12 or later and Stream Deck 7.1 or later.
- A Stream Deck Neo, or another Stream Deck with keys (other models are untested).
- A locally built `.streamDeckPlugin` package. The plugin has not yet been published to the Elgato Marketplace.

Double-click the package and confirm installation in Stream Deck. Drag **Focus Keys → Timer Preset** onto each key and set its **Minutes** in the settings panel; each new key starts at 5 minutes. Choose the style, colors and font for each key there. See the [user guide](docs/USER_GUIDE.md) for notifications, Focus setup, troubleshooting and privacy.

## Development

```sh
npm install
npm run build        # bundle src/ into the .sdPlugin folder
npm run notifier     # build the notification helper (ad-hoc signed)
npx streamdeck dev   # once per machine: enable developer mode
npm run link         # link the plugin into Stream Deck
npm run restart      # reload after a build

npm test
npm run typecheck
npm run validate
npm run package      # build and pack release/com.austinzani.focus-keys.streamDeckPlugin
```

The package and helper are generated locally and are not committed. For distribution, the helper must be signed with Developer ID and notarized; an ad-hoc build may need the Script Editor notification fallback. See [development](docs/DEVELOPMENT.md) for signing, packaging and release checks.

## Documentation

- [User guide](docs/USER_GUIDE.md): setup, settings, alerts, Focus, recovery, troubleshooting and privacy.
- [Development](docs/DEVELOPMENT.md): architecture, build, signing, checks and packaging.
- [Acceptance checklist](docs/ACCEPTANCE_CHECKLIST.md): real-device testing and current results.
- [Marketplace preparation](docs/MARKETPLACE.md): listing draft, requirements, imagery and remaining decisions.
- Background: [specification](docs/spec-draft.md), [ticket breakdown](docs/tickets-draft.md) and [platform research](docs/research.md).

## License

MIT; see [LICENSE](LICENSE). Bundled fonts and libraries retain their own licenses, listed in [Marketplace preparation](docs/MARKETPLACE.md#licensing).
