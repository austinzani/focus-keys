import { describe, expect, it } from "vitest";

import { TimedOutError } from "../src/alerts/macos";
import { ShortcutTimeoutError } from "../src/focus/dispatcher";
import { ShortcutsCli } from "../src/focus/shortcuts";

function fakeRun(result: { stdout?: string; error?: Error } = {}) {
	const calls: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
	const run = async (file: string, args: readonly string[], timeoutMs: number) => {
		calls.push({ file, args, timeoutMs });
		if (result.error) throw result.error;
		return result.stdout ?? "";
	};
	return { calls, run };
}

describe("Shortcuts command line", () => {
	it("runs a shortcut by name as one argument after `--`, so a name like `-o x` is never read as an option", async () => {
		const { calls, run } = fakeRun();
		await new ShortcutsCli(run).run("-o Work; $(id)");
		expect(calls).toEqual([{ file: "/usr/bin/shortcuts", args: ["run", "--", "-o Work; $(id)"], timeoutMs: ShortcutsCli.RUN_TIMEOUT_MS }]);
	});

	it.each([
		["a missing shortcut", "/usr/bin/shortcuts failed: Command failed (Error: The operation couldn’t be completed. Couldn’t find shortcut)", /No shortcut named "Work Focus"/],
		["a missing shortcuts command", "spawn /usr/bin/shortcuts ENOENT", /shortcuts command/],
		["a timeout", "/usr/bin/shortcuts failed: Command failed (killed SIGTERM)", /"Work Focus" failed/],
	])("explains %s in its error", async (_, message, expected) => {
		const { run } = fakeRun({ error: new Error(message) });
		await expect(new ShortcutsCli(run).run("Work Focus")).rejects.toThrow(expected);
	});

	it("reports a shortcut stopped at the time limit as a timeout, since it may have done its work", async () => {
		const { run } = fakeRun({ error: new TimedOutError("/usr/bin/shortcuts timed out after 30000 ms") });
		const running = new ShortcutsCli(run).run("Work Focus");
		await expect(running).rejects.toBeInstanceOf(ShortcutTimeoutError);
		await expect(running).rejects.toThrow(/"Work Focus" didn't finish within 30 seconds/);
	});

	it("lists shortcut names, one per line, sorted and without blanks or repeats", async () => {
		const { calls, run } = fakeRun({ stdout: "Work Focus\nFocus Off\n\nWork Focus\n  Reading  \n" });
		expect(await new ShortcutsCli(run).list()).toEqual(["Focus Off", "Reading", "Work Focus"]);
		expect(calls[0]).toMatchObject({ file: "/usr/bin/shortcuts", args: ["list"] });
	});
});
