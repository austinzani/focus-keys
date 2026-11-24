import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../src/core/coordinator";
import { FocusDispatcher, type ShortcutRunner, ShortcutTimeoutError } from "../src/focus/dispatcher";

const MIN = 60_000;
const ON = { focusEnabled: true, focusStartShortcut: "Work Focus", focusEndShortcut: "Focus Off" };

const started = (sessionId: number, keyId = "key-a"): SessionEvent => ({ type: "started", keyId, sessionId, durationMs: 5 * MIN });
const paused = (sessionId: number, keyId = "key-a"): SessionEvent => ({ type: "paused", keyId, sessionId });
const resumed = (sessionId: number, keyId = "key-a"): SessionEvent => ({ type: "resumed", keyId, sessionId });
const cancelled = (sessionId: number, keyId = "key-a"): SessionEvent => ({ type: "cancelled", keyId, sessionId });
const completed = (sessionId: number, keyId = "key-a"): SessionEvent => ({ type: "completed", keyId, sessionId, durationMs: 5 * MIN });
const replaced = (sessionId: number, fromState: "running" | "paused", keyId = "key-b"): SessionEvent => ({
	type: "replaced",
	keyId,
	sessionId,
	durationMs: 5 * MIN,
	fromKeyId: "key-a",
	fromState,
});

/** A fake `shortcuts` runner: records each run; names in `failing` reject, names in `timingOut` reject as timed out. */
function setup(
	settings: Record<string, unknown> | (() => Promise<Record<string, unknown>>) = ON,
	failing: string[] = [],
	timingOut: string[] = [],
	saved?: { focusSessionId: number; failSave?: boolean },
) {
	const ran: string[] = [];
	/** Saves of the Focus record and shortcut runs, in order. */
	const order: string[] = [];
	const failures: { keyId: string; message: string }[] = [];
	const errors: string[] = [];
	/** Every failure and success reported, in order. */
	const reports: string[] = [];
	const runner: ShortcutRunner = {
		run: async (name) => {
			ran.push(name);
			order.push(`run ${name}`);
			if (failing.includes(name)) throw new Error(`Couldn't find shortcut ${name}`);
			if (timingOut.includes(name)) throw new ShortcutTimeoutError(`Shortcut "${name}" timed out`);
		},
	};
	const dispatcher = new FocusDispatcher({
		loadSettings: typeof settings === "function" ? settings : async () => settings,
		shortcuts: runner,
		reportFailure: (keyId, message) => {
			failures.push({ keyId, message });
			reports.push(`failed: ${message}`);
		},
		reportSuccess: () => void reports.push("ok"),
		log: { info: () => {}, error: (m) => errors.push(m) },
		record:
			saved &&
			{
				focusSessionId: saved.focusSessionId,
				save: async (focusSessionId) => {
					order.push(`save ${focusSessionId}`);
					return saved.failSave !== true;
				},
			},
	});
	/** Delivers each event in its own batch once the previous one is done, as separate key presses would be. */
	const oneByOne = async (...events: SessionEvent[]) => {
		for (const event of events) await dispatcher.handle([event]);
	};
	return { dispatcher, oneByOne, ran, failures, errors, reports, order };
}

describe("focus dispatcher", () => {
	it("runs the start shortcut when a session starts and the end shortcut when it completes", async () => {
		const t = setup();
		await t.dispatcher.handle([started(1)]);
		expect(t.ran).toEqual(["Work Focus"]);
		await t.dispatcher.handle([completed(1)]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
	});

	it.each([
		["switching is off", { ...ON, focusEnabled: false }],
		["switching was never set up", {}],
		["settings are malformed", { focusEnabled: "yes", focusStartShortcut: 7, focusEndShortcut: ["x"] }],
	])("runs nothing when %s", async (_, settings) => {
		const t = setup(settings);
		await t.dispatcher.handle([started(1), paused(1), resumed(1), replaced(2, "running"), cancelled(2), started(3), completed(3)]);
		expect(t.ran).toEqual([]);
	});

	it.each([
		["pauses", paused(1)],
		["is cancelled", cancelled(1)],
		["completes", completed(1)],
	])("ends the focus session when the timer %s", async (_, end) => {
		const t = setup();
		await t.dispatcher.handle([started(1), end]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
	});

	it("starts Focus again when a paused session resumes", async () => {
		const t = setup();
		await t.oneByOne(started(1), paused(1), resumed(1), completed(1));
		expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus", "Focus Off"]);
	});

	it("keeps the focus session going when another preset replaces running work", async () => {
		const t = setup();
		await t.dispatcher.handle([started(1), replaced(2, "running"), replaced(3, "running", "key-c"), completed(3, "key-c")]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
	});

	it("starts Focus when another preset replaces paused work, since the pause already ended it", async () => {
		const t = setup();
		await t.oneByOne(started(1), paused(1), replaced(2, "paused"), cancelled(2, "key-b"));
		expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus", "Focus Off"]);
	});

	it("never runs a transition twice when events are delivered again", async () => {
		const t = setup();
		await t.dispatcher.handle([started(1), started(1), resumed(1)]);
		await t.dispatcher.handle([completed(1), completed(1), cancelled(1), paused(1)]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
	});

	it("does not start a session's Focus again when its start is replayed after a pause or its end", async () => {
		const t = setup();
		await t.dispatcher.handle([started(1), paused(1), started(1), completed(1), started(1)]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
	});

	it("leaves Focus as it is at the end when no end shortcut is chosen", async () => {
		const t = setup({ ...ON, focusEndShortcut: "  " });
		await t.oneByOne(started(1), paused(1), resumed(1), completed(1));
		expect(t.ran).toEqual(["Work Focus", "Work Focus"]);
	});

	it("does not run an end shortcut for work that started while switching was off", async () => {
		let settings: Record<string, unknown> = { ...ON, focusEnabled: false };
		const t = setup(async () => settings);
		await t.dispatcher.handle([started(1)]);
		settings = ON;
		await t.dispatcher.handle([completed(1)]);
		expect(t.ran).toEqual([]);
	});

	it("turning switching off mid-session suppresses the end shortcut", async () => {
		let settings: Record<string, unknown> = ON;
		const t = setup(async () => settings);
		await t.dispatcher.handle([started(1)]);
		settings = { ...ON, focusEnabled: false };
		await t.dispatcher.handle([completed(1), started(2), completed(2)]);
		expect(t.ran).toEqual(["Work Focus"]);
	});

	it("reports a failing shortcut on the key and logs it, without rejecting", async () => {
		const t = setup(ON, ["Work Focus"]);
		await expect(t.dispatcher.handle([started(1, "key-b")])).resolves.toBeUndefined();
		expect(t.failures).toEqual([{ keyId: "key-b", message: expect.stringContaining("Work Focus") }]);
		expect(t.errors).toEqual([expect.stringContaining("Work Focus")]);
	});

	it("reports each shortcut that ran, so an earlier problem can be cleared", async () => {
		const t = setup(ON, ["Focus Off"]);
		await t.oneByOne(started(1), completed(1), started(2));
		expect(t.reports).toEqual(["ok", expect.stringMatching(/^failed: .*Focus Off/), "ok"]);
	});

	it("does not run the end shortcut after the start shortcut failed, so it never undoes a Focus it didn't set", async () => {
		const t = setup(ON, ["Work Focus"]);
		await t.dispatcher.handle([started(1), completed(1)]);
		expect(t.ran).toEqual(["Work Focus"]);
	});

	it("still runs the end shortcut after the start shortcut timed out, since it may have set Focus already", async () => {
		const t = setup(ON, [], ["Work Focus"]);
		await t.oneByOne(started(1, "key-b"), paused(1, "key-b"));
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
		expect(t.failures).toEqual([{ keyId: "key-b", message: expect.stringContaining("timed out") }]);
	});

	it("reports a failing end shortcut, and starts cleanly next time", async () => {
		const t = setup(ON, ["Focus Off"]);
		await t.oneByOne(started(1), completed(1), started(2));
		expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus"]);
		expect(t.failures).toHaveLength(1);
	});

	it("runs transitions in order: an end waits for a slow start to finish", async () => {
		const log: string[] = [];
		let finishStart = () => {};
		const dispatcher = new FocusDispatcher({
			loadSettings: async () => ON,
			shortcuts: {
				run: (name) => {
					log.push(`run ${name}`);
					return name === "Work Focus" ? new Promise<void>((resolve) => (finishStart = () => (log.push("start done"), resolve()))) : Promise.resolve();
				},
			},
			reportFailure: () => {},
			reportSuccess: () => {},
			log: { info: () => {}, error: () => {} },
		});
		void dispatcher.handle([started(1)]);
		const ended = dispatcher.handle([paused(1)]);
		await new Promise((r) => setTimeout(r, 0));
		expect(log).toEqual(["run Work Focus"]);
		finishStart();
		await ended;
		expect(log).toEqual(["run Work Focus", "start done", "run Focus Off"]);
	});

	it("doesn't change Focus when the settings can't be read at a start, reports it on the key, and keeps going", async () => {
		let fail = true;
		const t = setup(async () => {
			if (fail) throw new Error("socket closed");
			return ON;
		});
		await t.dispatcher.handle([started(1, "key-b")]);
		fail = false;
		await t.oneByOne(completed(1), started(2));
		expect(t.ran).toEqual(["Work Focus"]);
		expect(t.errors).toEqual([expect.stringContaining("settings")]);
		expect(t.failures).toEqual([{ keyId: "key-b", message: "Couldn't read the Focus settings; Focus not changed" }]);
	});

	it("doesn't alert about unreadable settings when switching was off the last time they were read", async () => {
		let settings: Record<string, unknown> | Error = { ...ON, focusEnabled: false };
		const t = setup(async () => {
			if (settings instanceof Error) throw settings;
			return settings;
		});
		await t.dispatcher.handle([started(1)]);
		settings = new Error("socket closed");
		await t.oneByOne(completed(1), started(2));
		expect(t.ran).toEqual([]);
		expect(t.failures).toEqual([]);
	});

	it("ignores a late event from an earlier session, so it can't end the current one", async () => {
		const t = setup();
		await t.oneByOne(started(1), completed(1), started(2), completed(1), cancelled(1), paused(1));
		expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus"]);
	});

	it("ends with the last settings it could read when they can't be read at the end, and logs it", async () => {
		let fail = false;
		const t = setup(async () => {
			if (fail) throw new Error("socket closed");
			return ON;
		});
		await t.dispatcher.handle([started(1)]);
		fail = true;
		await t.dispatcher.handle([completed(1)]);
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
		expect(t.errors).toEqual([expect.stringContaining("Could not read Focus settings for the end transition")]);
		expect(t.failures).toEqual([]);
	});

	it("keeps running later transitions when reporting a failure throws", async () => {
		const ran: string[] = [];
		const dispatcher = new FocusDispatcher({
			loadSettings: async () => ON,
			shortcuts: {
				run: async (name) => {
					ran.push(name);
					if (name === "Work Focus" && ran.length === 1) throw new Error("boom");
				},
			},
			reportFailure: () => {
				throw new Error("key gone");
			},
			reportSuccess: () => {},
			log: { info: () => {}, error: () => {} },
		});
		await expect(dispatcher.handle([started(1)])).resolves.toBeUndefined();
		await expect(dispatcher.handle([started(2)])).resolves.toBeUndefined();
		expect(ran).toEqual(["Work Focus", "Work Focus"]);
	});

	describe("while a shortcut is still running", () => {
		/** Like setup(), but the first run of `slow` waits until `release()` is called. */
		function gated(slow: string) {
			const ran: string[] = [];
			let release = () => {};
			const dispatcher = new FocusDispatcher({
				loadSettings: async () => ON,
				shortcuts: {
					run: (name) => {
						ran.push(name);
						const first = name === slow && ran.indexOf(name) === ran.length - 1;
						return first ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
					},
				},
				reportFailure: () => {},
				reportSuccess: () => {},
				log: { info: () => {}, error: () => {} },
			});
			const settle = () => new Promise((r) => setTimeout(r, 0));
			return { dispatcher, ran, settle, release: () => release() };
		}

		it("collapses rapid pauses and resumes behind a stuck start into the latest one", async () => {
			const t = gated("Work Focus");
			void t.dispatcher.handle([started(1)]);
			for (let i = 0; i < 5; i++) void t.dispatcher.handle([paused(1)]), void t.dispatcher.handle([resumed(1)]);
			const done = t.dispatcher.handle([paused(1)]);
			await t.settle();
			expect(t.ran).toEqual(["Work Focus"]);
			t.release();
			await done;
			expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
		});

		it("drops a waiting start that a later end cancels, so Focus doesn't flicker on and off", async () => {
			const t = gated("Focus Off");
			await t.dispatcher.handle([started(1)]);
			void t.dispatcher.handle([paused(1)]);
			void t.dispatcher.handle([resumed(1)]);
			const done = t.dispatcher.handle([cancelled(1)]);
			await t.settle();
			t.release();
			await done;
			expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
		});

		it("keeps only the latest start when work resumes behind a stuck end, and still ends it later", async () => {
			const t = gated("Focus Off");
			await t.dispatcher.handle([started(1)]);
			void t.dispatcher.handle([paused(1)]);
			void t.dispatcher.handle([resumed(1)]);
			void t.dispatcher.handle([paused(1)]);
			const resumedAgain = t.dispatcher.handle([resumed(1)]);
			await t.settle();
			t.release();
			await resumedAgain;
			expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus"]);
			await t.dispatcher.handle([completed(1)]);
			expect(t.ran).toEqual(["Work Focus", "Focus Off", "Work Focus", "Focus Off"]);
		});
	});
});

describe("focus record across restarts", () => {
	it("saves the session before running its start shortcut, and clears it before running the end", async () => {
		const t = setup(ON, [], [], { focusSessionId: 0 });
		await t.oneByOne(started(1), completed(1));
		expect(t.order).toEqual(["save 1", "run Work Focus", "save 0", "run Focus Off"]);
	});

	it("clears the record when the start shortcut fails, and keeps it when it times out", async () => {
		const failed = setup(ON, ["Work Focus"], [], { focusSessionId: 0 });
		await failed.oneByOne(started(1));
		expect(failed.order).toEqual(["save 1", "run Work Focus", "save 0"]);

		const timedOut = setup(ON, [], ["Work Focus"], { focusSessionId: 0 });
		await timedOut.oneByOne(started(1));
		expect(timedOut.order).toEqual(["save 1", "run Work Focus"]);
	});

	it("moves the record to the new session when a preset change keeps Focus on, without running anything", async () => {
		const t = setup(ON, [], [], { focusSessionId: 0 });
		await t.oneByOne(started(1), replaced(2, "running"));
		expect(t.order).toEqual(["save 1", "run Work Focus", "save 2"]);
	});

	it("clears the record when the end runs nothing (switching off or no end shortcut)", async () => {
		const settings = { ...ON };
		const t = setup(async () => settings, [], [], { focusSessionId: 0 });
		await t.oneByOne(started(1));
		settings.focusEnabled = false;
		await t.oneByOne(paused(1));
		expect(t.order).toEqual(["save 1", "run Work Focus", "save 0"]);
	});

	it("doesn't run the start again for a restored session it already started, and ends it once", async () => {
		const t = setup(ON, [], [], { focusSessionId: 4 });
		await t.oneByOne(started(4), completed(4), completed(4));
		expect(t.ran).toEqual(["Focus Off"]);
	});

	it("ends a restored focus session whose work stopped while the plugin was stopped, once", async () => {
		const t = setup(ON, [], [], { focusSessionId: 4 });
		await Promise.all([t.dispatcher.endLeftover("key-a"), t.dispatcher.endLeftover("key-a")]);
		await t.dispatcher.endLeftover("key-a");
		expect(t.ran).toEqual(["Focus Off"]);
		expect(t.order).toEqual(["save 0", "run Focus Off"]);
	});

	it("ends a leftover focus session only once when its completion is also delivered", async () => {
		const t = setup(ON, [], [], { focusSessionId: 4 });
		const done = t.dispatcher.handle([completed(4)]);
		await Promise.all([done, t.dispatcher.endLeftover("key-a")]);
		expect(t.ran).toEqual(["Focus Off"]);
	});

	it("has nothing to end after a restart when it hadn't turned Focus on", async () => {
		const t = setup(ON, [], [], { focusSessionId: 0 });
		await t.dispatcher.endLeftover("key-a");
		expect(t.ran).toEqual([]);
	});

	it("saves the record again with the next transition after a failed save", async () => {
		const saved = { focusSessionId: 0, failSave: true };
		const t = setup(ON, [], [], saved);
		await t.oneByOne(started(1));
		saved.failSave = false;
		await t.oneByOne(replaced(2, "running"));
		await t.oneByOne(replaced(3, "running"));
		expect(t.order).toEqual(["save 1", "run Work Focus", "save 2", "save 3"]);
	});

	it("keeps Focus on through a preset change after a restart, and ends it once for the new session", async () => {
		const t = setup(ON, [], [], { focusSessionId: 4 });
		await t.oneByOne(replaced(5, "running"), completed(5));
		expect(t.order).toEqual(["save 5", "save 0", "run Focus Off"]);
	});

	it("still switches Focus when the record can't be saved, and logs it", async () => {
		const t = setup(ON, [], [], { focusSessionId: 0, failSave: true });
		await t.oneByOne(started(1), completed(1));
		expect(t.ran).toEqual(["Work Focus", "Focus Off"]);
		expect(t.errors).not.toHaveLength(0);
	});
});
