import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AfplaySoundPlayer, OsascriptNotifier, runFile, TimedOutError } from "../src/alerts/macos";
import { SOUND_IDS } from "../src/core/alerts";

function recordingRun() {
	const calls: { file: string; args: readonly string[] }[] = [];
	const run = async (file: string, args: readonly string[]) => (calls.push({ file, args }), "");
	return { calls, run };
}

describe.skipIf(process.platform !== "darwin")("macOS sound player", () => {
	it("plays each offered sound from the built-in macOS sounds with afplay", async () => {
		const { calls, run } = recordingRun();
		const player = new AfplaySoundPlayer(run);
		for (const sound of SOUND_IDS) await player.play(sound);

		expect(calls[0]).toEqual({ file: "/usr/bin/afplay", args: ["/System/Library/Sounds/Glass.aiff"] });
		for (const { file, args } of calls) {
			expect(file).toBe("/usr/bin/afplay");
			expect(existsSync(args[0])).toBe(true);
		}
	});
});

describe("macOS notifier", () => {
	it("passes the text as arguments, never as script source, and requests no notification sound", async () => {
		const { calls, run } = recordingRun();
		const text = `-x "quoted" \\ $(id) \`id\` end tell\nline 2 🍅`;
		await new OsascriptNotifier(run).notify("Focus Keys", text);

		const [{ file, args }] = calls;
		expect(file).toBe("/usr/bin/osascript");
		expect(args.slice(-3)).toEqual(["--", text, "Focus Keys"]);
		const script = args.slice(0, -3).join("\n");
		expect(script).not.toContain(text);
		expect(script).not.toContain("sound name");
	});
});

describe.skipIf(process.platform !== "darwin")("running a helper program", () => {
	it("resolves with its output when it exits 0", async () => {
		await expect(runFile("/bin/echo", ["hello"], 5_000)).resolves.toBe("hello\n");
	});

	it("rejects when it exits non-zero or cannot be started", async () => {
		await expect(runFile("/usr/bin/false", [], 5_000)).rejects.toThrow(/\/usr\/bin\/false/);
		await expect(runFile("/nonexistent/afplay", [], 5_000)).rejects.toThrow(/ENOENT/);
	});

	it("rejects when it runs past the timeout", async () => {
		const running = runFile("/bin/sleep", ["5"], 100);
		await expect(running).rejects.toThrow(/sleep timed out after 100 ms/);
		await expect(running).rejects.toBeInstanceOf(TimedOutError);
	});

	it("rejects as too much output, not as a timeout, when it writes more than it may", async () => {
		const running = runFile("/usr/bin/yes", [], 5_000);
		await expect(running).rejects.toThrow(/yes wrote more output than allowed/);
		await expect(running).rejects.not.toBeInstanceOf(TimedOutError);
	});
});
