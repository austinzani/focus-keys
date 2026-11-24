// Builds the notification helper app (native/notifier) into the plugin as notifier/Focus Keys.app, so banners
// show "Focus Keys" instead of Script Editor. Universal (arm64 + x86_64), macOS 12+. Needs Xcode command line tools.
//
//   npm run notifier                      ad-hoc signed: works on this Mac only. Fine for development.
//   npm run notifier -- --sign "Developer ID Application: Name (TEAMID)" --notarize <keychain-profile>
//                                         release build: Developer ID signed, hardened runtime, notarized and stapled.
//
// The keychain profile is one made once with
//   xcrun notarytool store-credentials <profile> --apple-id <email> --team-id <TEAMID>
// (it asks for an app-specific password from account.apple.com). The built app is git-ignored; `npm run package`
// refuses to pack without it, and warns when it isn't notarized.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "native", "notifier");
const app = join(root, "com.austinzani.focus-keys.sdPlugin", "notifier", "Focus Keys.app");
const exe = "focus-keys-notifier";
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const { values } = parseArgs({ options: { sign: { type: "string", default: "-" }, notarize: { type: "string" } } });
const adHoc = values.sign === "-";
if (values.notarize !== undefined && adHoc) {
	console.error("build-notifier: --notarize needs --sign with a Developer ID Application identity");
	process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const tmp = mkdtempSync(join(tmpdir(), "focus-keys-notifier-"));
try {
	rmSync(app, { recursive: true, force: true });
	mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
	mkdirSync(join(app, "Contents", "Resources"), { recursive: true });

	// One slice per architecture, then a universal binary.
	const slices = ["arm64", "x86_64"].map((arch) => {
		const out = join(tmp, `${exe}-${arch}`);
		run("xcrun", ["swiftc", "-O", "-target", `${arch}-apple-macos12.0`, join(src, "main.swift"), "-o", out]);
		return out;
	});
	run("xcrun", ["lipo", "-create", ...slices, "-output", join(app, "Contents", "MacOS", exe)]);

	// Info.plist with the plugin's version.
	const plist = readFileSync(join(src, "Info.plist"), "utf8")
		.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*/, `$1${version}`)
		.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]*/, `$1${version}`);
	writeFileSync(join(app, "Contents", "Info.plist"), plist);

	// App icon from the plugin icon (512 px), so the banner shows the same ring.
	const iconset = join(tmp, "AppIcon.iconset");
	mkdirSync(iconset);
	const icon = join(root, "com.austinzani.focus-keys.sdPlugin", "imgs", "plugin", "marketplace@2x.png");
	for (const size of [16, 32, 128, 256]) {
		run("sips", ["-z", String(size), String(size), icon, "--out", join(iconset, `icon_${size}x${size}.png`)]);
		run("sips", ["-z", String(size * 2), String(size * 2), icon, "--out", join(iconset, `icon_${size}x${size}@2x.png`)]);
	}
	copyFileSync(icon, join(iconset, "icon_512x512.png"));
	run("iconutil", ["-c", "icns", iconset, "-o", join(app, "Contents", "Resources", "AppIcon.icns")]);

	// Sign. A release build uses the hardened runtime and a secure timestamp, both required for notarization.
	const signArgs = ["--force", "--sign", values.sign];
	if (!adHoc) signArgs.push("--options", "runtime", "--timestamp");
	run("codesign", [...signArgs, app]);
	run("codesign", ["--verify", "--strict", "--verbose=2", app]);

	if (values.notarize !== undefined) {
		const zip = join(tmp, "notifier.zip");
		run("ditto", ["-c", "-k", "--keepParent", app, zip]);
		run("xcrun", ["notarytool", "submit", zip, "--keychain-profile", values.notarize, "--wait"]);
		run("xcrun", ["stapler", "staple", app]);
		run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
	}
	console.log(`\n${app} (${adHoc ? "ad-hoc signed: this Mac only" : values.notarize ? "Developer ID, notarized" : "Developer ID, NOT notarized"})`);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
