# Focus Keys

A Mac-only Stream Deck plugin that turns keys into whole-minute countdown timers. Each key shows a large number of minutes and a progress ring; tap to start, pause or resume, hold to cancel. It can play a sound or show a notification when time is up, and can switch macOS Focus through your own Shortcuts. Designed for the Stream Deck Neo; it uses ordinary keys, so other Stream Deck models should work but are untested.

Requirements: macOS 12 or later, Stream Deck 7.1 or later. Mac only.

## Documentation

- [User guide](docs/USER_GUIDE.md): install, setup, settings, alerts, Focus, sleep and restart behavior, troubleshooting, limitations, privacy.
- [Development](docs/DEVELOPMENT.md): build, checks, code layout, internals, packaging, renaming.
- [Acceptance checklist](docs/ACCEPTANCE_CHECKLIST.md): the owner's real-device pass before release.
- [Marketplace](docs/MARKETPLACE.md): listing draft, requirements, imagery, licensing, submission steps.
- Background: [specification](docs/spec-draft.md), [ticket breakdown](docs/tickets-draft.md), [platform research](docs/research.md).

## Quickstart (development)

```sh
npm install
npm run build        # bundle src/ into the .sdPlugin folder
npm run notifier     # build the notification helper app (ad-hoc signed; see docs/DEVELOPMENT.md for release signing)
npx streamdeck dev   # once per machine: Stream Deck developer mode
npm run link         # link the plugin into Stream Deck, then: npm run restart
npm run package      # build, validate and pack release/com.austinzani.focus-keys.streamDeckPlugin
```

## License

MIT, see [LICENSE](LICENSE). Bundled fonts (SIL OFL 1.1) and libraries keep their own licenses; see [docs/MARKETPLACE.md](docs/MARKETPLACE.md#licensing).
