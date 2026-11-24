import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { restoreExecutableInArchive } from "../scripts/package-permissions.mjs";

let fixture;
afterEach(() => {
	if (fixture) rmSync(fixture, { recursive: true, force: true });
});

it("preserves the helper executable and its bytes when the package is extracted", () => {
	fixture = mkdtempSync(join(tmpdir(), "focus-keys-package-test-"));
	const entry = "plugin/notifier/Focus Keys.app/Contents/MacOS/focus-keys-notifier";
	const source = join(fixture, entry);
	const archive = join(fixture, "plugin.zip");
	const extracted = join(fixture, "extracted");
	mkdirSync(dirname(source), { recursive: true });
	writeFileSync(source, "signed helper bytes");
	writeFileSync(join(fixture, "manifest.json"), "{}");
	chmodSync(source, 0o644);
	execFileSync("zip", ["-q", archive, "manifest.json", entry], { cwd: fixture });
	chmodSync(source, 0o755);

	restoreExecutableInArchive(archive, fixture, entry);

	mkdirSync(extracted);
	execFileSync("unzip", ["-q", archive, "-d", extracted]);
	const result = join(extracted, entry);
	expect(statSync(result).mode & 0o111).toBe(0o111);
	expect(readFileSync(result, "utf8")).toBe("signed helper bytes");
});
