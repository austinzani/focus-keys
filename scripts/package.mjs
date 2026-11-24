// Builds, validates and packs the plugin into release/<uuid>.streamDeckPlugin for direct install or Maker Console upload.
// Needs the notification helper (npm run notifier) and warns when it isn't notarized.
// Refuses to pack a development manifest (Nodejs.Debug set) or a manifest/package.json version mismatch.
// Usage: npm run package
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sdPlugin = "com.austinzani.focus-keys.sdPlugin";
const manifestPath = join(root, sdPlugin, "manifest.json");
const manifestText = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const outDir = join(root, "release");

const fail = (message) => {
	console.error(`package: ${message}`);
	process.exit(1);
};
if (manifest.Nodejs?.Debug !== undefined) {
	fail(`remove Nodejs.Debug from ${sdPlugin}/manifest.json before packaging (it is for local debugging only).`);
}
// Manifest versions are x.x.x.x; package.json is semver x.x.x. They must agree on the first three parts.
if (manifest.Version !== `${pkg.version}.0`) {
	fail(`manifest Version ${manifest.Version} does not match package.json version ${pkg.version} (expected ${pkg.version}.0).`);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

// The notification helper app is built separately (signing is per machine) and must be in the plugin folder.
const notifierApp = join(root, sdPlugin, "notifier", "Focus Keys.app");
if (!existsSync(notifierApp)) fail(`build the notification helper first: npm run notifier (see scripts/build-notifier.mjs).`);
let notarized = true;
try {
	execFileSync("xcrun", ["stapler", "validate", notifierApp], { stdio: "ignore" });
} catch {
	notarized = false;
}

run("npx", ["rollup", "-c"]);
// pack validates first and refuses to bundle an invalid plugin. It also rewrites manifest.json in its own
// formatting, so the committed text is put back afterwards.
try {
	run("npx", ["streamdeck", "pack", sdPlugin, "--output", outDir, "--force", "--no-update-check"]);
} finally {
	writeFileSync(manifestPath, manifestText);
}

const file = join(outDir, `${manifest.UUID}.streamDeckPlugin`);
console.log(`\n${file} (${(statSync(file).size / 1024).toFixed(1)} KiB, version ${manifest.Version})`);
if (!notarized) {
	console.warn("WARNING: the notification helper isn't notarized. Fine on this Mac; rebuild it with --sign/--notarize before a release (scripts/build-notifier.mjs).");
}
