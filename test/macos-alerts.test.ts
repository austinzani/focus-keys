import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	AfplaySoundPlayer,
	FallbackNotifier,
	HelperNotifier,
	type HelperFiles,
	NotificationPendingError,
	NotificationsOffError,
	OsascriptNotifier,
	runFile,
	TimedOutError,
} from "../src/alerts/macos";
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

/** A fake helper: `answer` is what it writes to the result file once launched (undefined: never answers). */
function fakeHelper(answer: string | undefined, { installed = true, launchFails = false } = {}) {
	const launched: (readonly string[])[] = [];
	const removed: string[] = [];
	let written: string | undefined;
	const run = async (file: string, args: readonly string[]) => {
		if (launchFails) throw new Error("open failed");
		launched.push([file, ...args]);
		written = answer;
		return "";
	};
	const files: HelperFiles = {
		exists: async () => installed,
		read: async () => written,
		remove: async (path) => void removed.push(path),
		tempPath: () => "/tmp/result.txt",
		sleep: async () => {},
	};
	return { notifier: new HelperNotifier("/plugin/notifier/Focus Keys.app", run, files), launched, removed };
}

describe("notification helper", () => {
	it("launches the helper app through open with the text as arguments and resolves on ok", async () => {
		const h = fakeHelper("ok\n");
		await h.notifier.notify("Focus Keys", "Time's up");
		expect(h.launched).toEqual([
			["/usr/bin/open", "-n", "-g", "/plugin/notifier/Focus Keys.app", "--args", "--title", "Focus Keys", "--body", "Time's up", "--result", "/tmp/result.txt"],
		]);
		expect(h.removed).toEqual(["/tmp/result.txt"]);
	});

	it.each([
		["notifications are off", fakeHelper("denied"), NotificationsOffError],
		["the helper never answers", fakeHelper(undefined), NotificationPendingError],
	])("reports when %s", async (_, h, error) => {
		await expect(h.notifier.notify("t", "b")).rejects.toBeInstanceOf(error);
	});

	it.each([
		["reports an error", fakeHelper("error: authorization failed")],
		["is missing", fakeHelper("ok", { installed: false })],
		["can't be launched", fakeHelper("ok", { launchFails: true })],
	])("fails plainly when the helper %s", async (_, h) => {
		const err = await h.notifier.notify("t", "b").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(NotificationsOffError);
		expect(err).not.toBeInstanceOf(NotificationPendingError);
	});
});

describe("notifier fallback", () => {
	const recorder = () => {
		const shown: string[] = [];
		return { shown, notifier: { notify: async (title: string, body: string) => void shown.push(`${title}: ${body}`) } };
	};
	const failing = (err: Error) => ({ notify: async () => Promise.reject(err) });

	it("uses only the helper when it works", async () => {
		const helper = recorder();
		const script = recorder();
		await new FallbackNotifier(helper.notifier, script.notifier, { error: () => {} }).notify("Focus Keys", "done");
		expect(helper.shown).toEqual(["Focus Keys: done"]);
		expect(script.shown).toEqual([]);
	});

	it("falls back to Script Editor when the helper fails, and logs why", async () => {
		const script = recorder();
		const errors: string[] = [];
		await new FallbackNotifier(failing(new Error("not found")), script.notifier, { error: (m) => void errors.push(m) }).notify("Focus Keys", "done");
		expect(script.shown).toEqual(["Focus Keys: done"]);
		expect(errors).toHaveLength(1);
	});

	it.each([new NotificationsOffError("off"), new NotificationPendingError("waiting")])("doesn't show a second banner when %s", async (err) => {
		const script = recorder();
		await expect(new FallbackNotifier(failing(err), script.notifier, { error: () => {} }).notify("t", "b")).rejects.toBe(err);
		expect(script.shown).toEqual([]);
	});
});
