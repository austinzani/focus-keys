# Marketplace preparation

Status of everything needed to publish on the Elgato Marketplace, plus draft listing copy. Nothing has been submitted and no Maker account has been created. Requirements were checked against Elgato's docs on 2026-11-23; links are next to each item. Items marked UNVERIFIED couldn't be confirmed in Elgato's docs.

Main sources:

- Plugin guidelines: https://docs.elgato.com/guidelines/stream-deck/plugins (also bundled at `node_modules/@elgato/streamdeck/docs/style-guide/plugin-guidelines.mdx`)
- Product and submission guidelines: https://docs.elgato.com/guidelines/products, https://docs.elgato.com/guidelines/submissions, https://docs.elgato.com/guidelines/branding
- Distribution and DRM: https://docs.elgato.com/sdk/plugins/distribution
- Manifest reference: https://docs.elgato.com/streamdeck/sdk/references/manifest
- `pack` command: https://docs.elgato.com/streamdeck/cli/commands/pack
- Maker Console: https://docs.elgato.com/general/become-a-maker, https://docs.elgato.com/maker-console/submitting-products, https://docs.elgato.com/maker-console/review-process, https://docs.elgato.com/maker-console/managing-products

## Requirement checklist

Status: **done**, **owner** (needs an owner decision or action), **asset** (needs an asset made or approved).

### Package and manifest

| Requirement | Status | Notes |
| --- | --- | --- |
| Packed with `streamdeck pack`; validation passes | done | `npm run package` builds, validates and packs `release/com.austinzani.focus-keys.streamDeckPlugin`. |
| Required manifest fields: Actions, Author, CodePath, Description, Icon, Name, OS, SDKVersion, Software.MinimumVersion, UUID, Version | done | All present. |
| `Version` in `x.x.x.x` form | done | `0.1.5.0`; `package.json` is `0.1.5`, and `npm run package` checks they match. |
| UUID: reverse DNS, lowercase a–z, 0–9, `-`, `.`; includes author and plugin name; action UUIDs prefixed with it | done | `com.austinzani.focus-keys`, actions `com.austinzani.focus-keys.preset` and `.break`. **Must be final before the first publish.** Elgato's guidelines say not to change UUIDs after publishing; a new UUID is a different plugin, and keys users placed stop working. See "Renaming before first publish" in [DEVELOPMENT.md](DEVELOPMENT.md). |
| DRM readiness: `@elgato/streamdeck` v2+, `SDKVersion` 3, `Software.MinimumVersion` ≥ 6.9, CLI ≥ 1.6, manifest never read at runtime, shipped files never modified | done | SDK 3.0.6, SDKVersion 3, minimum Stream Deck 7.1, CLI 1.10.5. The plugin doesn't read `manifest.json`. It writes only to its state folder (`~/Library/Application Support/com.austinzani.focus-keys/`: `state.json`, its temporary files and any moved-aside backup) and its logs, never its shipped files. Elgato now requires DRM compatibility for new submissions and updates (seen only in a Maker Console search snippet; UNVERIFIED). |
| No debug settings in the release manifest | done | `Nodejs.Debug` removed; `npm run package` refuses to pack if it's back. Whether Elgato blocks it is undocumented. |
| No dev files in the package | done | `.sdignore` excludes `logs/`, `.DS_Store`, `*.map`; CLI defaults exclude `.git`, `/.env*`, `*.log`, `*.js.map`. Package has 21 files, about 121 KiB. |
| Third-party licenses ship with the plugin | done | `licenses/fonts/` (5 × SIL OFL 1.1 + NOTICE), `ui/vendor/LICENSES.md` (sdpi-components MIT, Lit BSD-3-Clause), `bin/THIRD_PARTY_LICENSES.txt` (bundled npm code: @elgato/streamdeck, @elgato/utils, @elgato/schemas, @streamdeck/core, ws, zod: MIT; tslib: 0BSD). |
| `OS` declares only supported platforms | done | `mac`, minimum 12. Reviewers check device and OS claims. |
| Category and action names ≤ ~30 characters, category same as or close to plugin name, tooltips set | done | Category "Focus Keys", actions "Timer Preset" and "Break", tooltips set. |
| Optional `SupportURL` in manifest (per action; the schema has no plugin-level URL) | done | Both actions link to GitHub Issues. Update if the repo is renamed. |
| Guideline: offer 2 to 30 actions | done | Two actions: Timer Preset and Break (a timer that never switches Focus). |
| Bundled native binary (notification helper `notifier/Focus Keys.app`) | owner | Must be Developer ID signed and notarized before packaging a release (`npm run notifier -- --sign … --notarize …`; see DEVELOPMENT.md). UNVERIFIED: whether Elgato's DRM leaves bundled binaries untouched (a modified binary breaks its signature). If it doesn't, banners fall back to Script Editor. Check after the first upload, or ask maker@elgato.com. Mention the helper in the review notes. |
| Use `showAlert` when an action fails | partial | Shown when a Focus shortcut fails. A failed sound or notification (`afplay`/`osascript`) is only logged; the timer itself has no failure case. |
| ≤ 10 key updates per second | done | Keys redraw only on ring steps, minute boundaries and state changes. |

### Imagery

| Asset | Required size | Status |
| --- | --- | --- |
| Plugin icon (`Icon`) | PNG 256 × 256 and 512 × 512 (@2x) | done: `imgs/plugin/marketplace.png` / `@2x`. Running "25" with a tomato ring on a rounded dark tile. |
| Category icon | 28 × 28 / 56 × 56 PNG, or SVG; monochrome white, transparent | done: `imgs/plugin/category-icon.png` / `@2x`. White ring and "5". |
| Action list icon | 20 × 20 / 40 × 40 PNG, or SVG; white, no color, no solid background | done: `imgs/actions/preset/icon.png` / `@2x`. |
| Key image (`States.Image`) | 72 × 72 / 144 × 144 | done: `imgs/actions/preset/key.png` / `@2x`. Same idle "5" a new key draws. |
| Maker Console app icon | 288 × 288 PNG, static, no "Official", no URLs | asset: draft `release/gallery/app-icon-288.png`. Guidelines ask for the name or a logo in bold, readable type; the draft is the ring logo only. Owner approves or adds the final name. |
| Thumbnail | 1920 × 960 PNG | asset: draft `release/gallery/1-four-keys.png`. |
| Gallery | 3 to 10 items; images 1920 × 960 PNG; video MP4 up to 1920 × 1080, under 250 MB; readable English text | asset: drafts `release/gallery/2-states.png`, `3-colors.png`, `4-fonts.png`. They have no captions. Elgato asks for real-looking product media, not low-quality screenshots; add captions and at least one photo or video of the physical Neo after the acceptance pass. |

All plugin images and drafts come from `npm run icons` (`scripts/generate-icons.mjs`), which draws them with the plugin's own key renderer and the bundled OFL digit outlines. No third-party brand assets are used. `release/` is git-ignored; rerun `npm run icons` to recreate the drafts.

### Listing and maker account

| Requirement | Status | Notes |
| --- | --- | --- |
| Maker Console organization and signed Maker Agreement (org Settings) | owner | Create at https://maker.elgato.com. Free products need no Stripe setup; paid ones use Stripe Connect with a 70/30 split. Identity verification steps: UNVERIFIED. |
| Public identity | owner | The manifest `Author` ("Austin Zani") appears on the product page, and the org gets a public page at `marketplace.elgato.com/@<handle>`. Guidelines allow a real name, an alias or an org name; use the org name if you create one. |
| Name: unique, ≤ ~30 characters, English, no trademarks, no promo words, no emoji | done (owner: formal trademark check) | Focus Keys. See "Name" below. **Name and monetization are locked once the product is created**; changing them later means emailing maker@elgato.com. |
| Description: 250 to 1,500 characters; the first 250 plain text saying what it does and for whom; English; no keyword stuffing | done (draft) | See "Listing copy". |
| Tags and type (category) | owner | Set in Maker Console › Details. Suggested below. |
| Release notes for every version | done (draft) | See below. |
| Price | owner | Free suggested for 0.1. |
| Privacy policy | done (once the repo is public) | Required only if the plugin collects identifiable data. It doesn't: no network access, no analytics. Link the user guide's Privacy section: https://github.com/austinzani/focus-keys/blob/main/docs/USER_GUIDE.md#privacy |
| Support / website links | done (once the repo is public) | Support: https://github.com/austinzani/focus-keys/issues. Website: the repo. |
| AI disclosure | owner | Elgato requires disclosing AI use, and products made entirely by AI aren't eligible. This plugin was written with substantial AI assistance under the owner's direction, review and testing. Describe that honestly in the submission. Whether it qualifies is Elgato's call. |
| Brand spelling | done | Copy uses "Stream Deck", "Stream Deck Neo", "plugin", "key" per https://docs.elgato.com/guidelines/branding. |

## Name

**Focus Keys** (`com.austinzani.focus-keys`), chosen by the owner on 2026-11-24.

Why not the earlier names: "Pomodoro®" is a registered trademark of Francesco Cirillo, and using it needs permission (https://www.pomodorotechnique.com/pomodoro-trademark-guidelines.php). Elgato's guidelines forbid trademarks in product and plugin names (https://docs.elgato.com/guidelines/products, https://docs.elgato.com/guidelines/stream-deck/plugins). "Neo" echoes Elgato's own product name. A plain "Focus Timer" collides with BarRaider's Stream Countdown Timer "Focus Timer" mode and with FocusTimer Pro.

Desk check of "Focus Keys" on 2026-11-24: a web search found no Stream Deck plugin with that name. Nearby Marketplace names: Focus, FocusTimer Pro and Countdown Keys. This was a web search only, not a formal trademark search. Before creating the product, search https://marketplace.elgato.com/stream-deck/plugins and a trademark database (for example USPTO, class 9) for "Focus Keys".

## Listing copy (draft)

Claims are limited to behavior in the code and the user guide; Focus restore and notification attribution are stated as limits, not features. Recovery after sleep, restart and reconnect is implemented and unit-tested but not yet checked on the device: keep those lines only if the acceptance pass confirms them.

**Short description (manifest `Description`, under 250 characters):**

> A calm focus timer for Stream Deck keys. Each key is a preset in whole minutes with a progress ring or background sweep. Tap to start, pause or resume, hold to cancel. Mac only.

**Long description (about 1,200 characters):**

> Focus Keys turns Stream Deck keys into a quiet whole-minute timer for focused work on a Mac. Put one key per preset on your Stream Deck Neo and start a session with one tap.
>
> Each key shows its minutes in large type. Choose a shrinking ring or a background that sweeps across or down as time passes; there are no seconds to watch. Tap the running key to pause or resume, hold it to cancel, or tap another key to switch presets. One session runs at a time.
>
> When time is up, the key shows 0 and the plugin plays one of the built-in macOS sounds. It can also show a macOS notification with your own text.
>
> Give each key its own style, colors and one of five number fonts. Durations run from 1 to 180 minutes.
>
> Optional Focus switching: choose your own Shortcuts to run when work starts and ends, for example to turn a work Focus on and off. Your previous Focus isn't restored, and Focus changes you make by hand aren't detected.
>
> The timer keeps the right time across sleep, Stream Deck restarts and reconnects, and alerts once for a session that ended while the Mac slept.
>
> Everything stays on your Mac: no account, no internet access, no analytics.
>
> Requires macOS 12 or later and Stream Deck 7.1 or later.

**Features (bullets for the listing or gallery captions):**

- Whole-minute countdown with a progress ring or background sweep, no seconds
- Tap to start, pause and resume; hold to cancel; tap another key to switch
- Break key that shares the timer but never turns Focus on
- Per-key duration (1–180 min), style, colors and font
- Completion sound and optional macOS notification with custom text
- Optional Focus switching through your own Shortcuts
- Survives sleep, restarts and reconnects; alerts once for a missed finish
- Local only: no internet, no account

**Known limitations (state them in the listing or the support page):**

- Mac only.
- A Focus can hide notifications. The sound plays either way.
- Focus switching runs your shortcuts; it doesn't restore the previous Focus or notice manual changes. If Focus is shared across devices, your other devices follow.
- A Mac that's asleep can't play the alert; it plays once on wake.
- One timer at a time.

**Devices:** built for and to be tested on Stream Deck Neo (acceptance pass pending). The action is a plain key action, so other models with keys should work, but don't claim them until tested.

**Suggested type and tags:** Productivity; tags: timer, focus, productivity, countdown, work sessions.

**Release notes 0.1.5:**

> First release. Whole-minute timer keys and a Break key with a progress ring or background sweep, completion sound and notification, per-key styles, colors and font, optional Focus switching through Shortcuts, and recovery across sleep and restarts.

## Licensing

| Component | License | Where |
| --- | --- | --- |
| Digit outlines from Inter, Nunito, Oswald, JetBrains Mono, Bitter (Fontsource 5.3.0) | SIL OFL 1.1, no Reserved Font Name | `licenses/fonts/` |
| sdpi-components 4.0.1 (Property Inspector) | MIT | `ui/vendor/LICENSES.md` |
| Lit (inside sdpi-components) | BSD-3-Clause | `ui/vendor/LICENSES.md` |
| @elgato/streamdeck and its runtime dependencies, bundled into `plugin.js` | MIT; tslib 0BSD | `bin/THIRD_PARTY_LICENSES.txt` |
| macOS system sounds | Not bundled; played from `/System/Library/Sounds` | none needed |
| This project's own source | MIT | `LICENSE` (repo root), `LICENSE.txt` (in the plugin) |

Source license: MIT, chosen by the owner on 2026-11-24. It is compatible with every bundled license above.

## Owner steps to submit

1. Finish [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) on the real Neo from the packaged build, and fix any release blockers.
2. Decide the name and UUID. If they change, follow "Renaming before first publish" in [DEVELOPMENT.md](DEVELOPMENT.md), run `npm run icons`, rerun the checks and repeat the acceptance smoke test.
3. Decide the source license, support URL and privacy statement link. Add `URL`/`SupportURL` to the manifest if you want them.
4. Run `npm run package`. Upload `release/<uuid>.streamDeckPlugin`.
5. At https://maker.elgato.com: create the organization, sign the Maker Agreement, and set the public handle.
6. Create the product (name and pricing lock here). Files: upload the package. Details: type, tags, description, links. Media: app icon (288 px), thumbnail and 3 to 10 gallery items at 1920 × 960, release notes. Disclose AI use.
7. Optional beta: untick "Publish after review", then download the DRM-protected build from the Versions tab and test it on the Neo before publishing.
8. Submit. Review takes 4 to 10 working days; results come by email from maker@elgato.com. Statuses: Pending review → Approved → Published (automatic unless turned off), or Rejected with requested changes. A published listing can take up to 3 hours to appear.
9. Record the review and publication state in AUS-1885.
