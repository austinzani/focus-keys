import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresetController } from "../src/actions/preset-controller";
import { HOLD_MS, type KeyRender } from "../src/core/coordinator";
import { systemClock } from "../src/core/clock";
import { FocusDispatcher } from "../src/focus/dispatcher";
import { StateStore, type StateStorage } from "../src/persistence/store";
import { fakeAlertPorts, memoryStorage } from "./support";

const MIN = 60_000;

/**
 * The plugin's wiring without the Stream Deck SDK: key events in, painted keys and alerts out, driven by
 * the real wake timer under vitest's fake timers (which also fake Date.now, read by the system clock).
 */
function setup(settings = {}, focusSettings = {}, failingShortcuts = false) {
	const alerts = fakeAlertPorts(settings);
	const ranShortcuts: string[] = [];
	const focusFailures: string[] = [];
	const focus = new FocusDispatcher({
		loadSettings: async () => focusSettings,
		shortcuts: {
			run: async (name) => {
				ranShortcuts.push(name);
				if (failingShortcuts) throw new Error("Couldn't find shortcut");
			},
		},
		reportFailure: (keyId) => focusFailures.push(keyId),
		reportSuccess: () => {},
		log: { info: () => {}, error: () => {} },
	});
	const painted = new Map<string, KeyRender>();
	const controller = new PresetController({
		clock: systemClock,
		paint: (render) => painted.set(render.keyId, render),
		alerts: alerts.dispatcher,
		focus,
		log: { info: () => {}, error: () => {} },
	});
	return {
		controller,
		painted,
		alerts,
		ranShortcuts,
		focusFailures,
		tap: (keyId: string) => (controller.keyDown(keyId), controller.keyUp(keyId)),
	};
}

const FOCUS_ON = { focusEnabled: true, focusStartShortcut: "Work Focus", focusEndShortcut: "Focus Off" };

describe("preset controller", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it("shows 0 and plays the sound once when the timer reaches zero on its own", async () => {
		const t = setup({ sound: "funk" });
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");

		await vi.advanceTimersByTimeAsync(5 * MIN - 1_000);
		expect(t.alerts.played).toEqual([]);
		await vi.advanceTimersByTimeAsync(1_000 + 50);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual(["funk"]);

		await vi.advanceTimersByTimeAsync(30 * MIN);
		expect(t.alerts.played).toEqual(["funk"]);
	});

	it("alerts once when the session completes while its key is not visible", async () => {
		const t = setup();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		t.controller.keyDisappeared("key-a"); // e.g. another Stream Deck page is shown

		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass"]);
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		await vi.advanceTimersByTimeAsync(MIN);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("never alerts for a cancelled session", async () => {
		const t = setup({ notificationEnabled: true });
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		t.controller.keyDown("key-a");
		await vi.advanceTimersByTimeAsync(HOLD_MS + 50); // held: cancel
		t.controller.keyUp("key-a");

		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(t.painted.get("key-a")).toMatchObject({ state: "idle", minutes: 5 });
		expect(t.alerts.played).toEqual([]);
		expect(t.alerts.notified).toEqual([]);
	});

	it("alerts only for the replacing session, not the replaced one", async () => {
		const t = setup({ notificationEnabled: true });
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.controller.keyAppeared("key-b", { durationMinutes: 15 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(2 * MIN);
		t.tap("key-b");

		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(t.alerts.played).toEqual([]);
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass"]);
		expect(t.alerts.notified).toEqual([{ title: "Neo Pomodoro", body: "Time's up: 15-minute timer finished." }]);
	});

	it("keeps counting and showing 0 when the notification fails", async () => {
		const t = setup({ notificationEnabled: true });
		t.alerts.failing.notify = true;
		t.controller.keyAppeared("key-a", { durationMinutes: 1 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });

		t.tap("key-a"); // a finished key starts again
		expect(t.painted.get("key-a")).toMatchObject({ state: "running", minutes: 1 });
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.alerts.played).toEqual(["glass", "glass"]);
	});

	it("logs an alert that fails outright and keeps the timer working", async () => {
		const errors: string[] = [];
		const painted = new Map<string, KeyRender>();
		const controller = new PresetController({
			clock: systemClock,
			paint: (render) => painted.set(render.keyId, render),
			alerts: { handle: () => Promise.reject(new Error("boom")) },
			focus: { handle: () => Promise.reject(new Error("boom")) },
			log: { info: () => {}, error: (msg) => void errors.push(msg) },
		});
		controller.keyAppeared("key-a", { durationMinutes: 1 });
		controller.keyDown("key-a");
		controller.keyUp("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);

		expect(painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(errors.length).toBeGreaterThan(0);
	});

	it("switches Focus once for running work, keeps it through a preset change, and ends it on completion", async () => {
		const t = setup({}, FOCUS_ON);
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.controller.keyAppeared("key-b", { durationMinutes: 15 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(2 * MIN);
		t.tap("key-b");
		await vi.advanceTimersByTimeAsync(10 * MIN);
		expect(t.ranShortcuts).toEqual(["Work Focus"]);

		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off"]);
	});

	it("ends Focus on pause and starts it again on resume", async () => {
		const t = setup({}, FOCUS_ON);
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(0);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off", "Work Focus"]);
	});

	it("keeps counting down when the Focus shortcut can't run, and flags the key", async () => {
		const t = setup({}, FOCUS_ON, true);
		t.controller.keyAppeared("key-a", { durationMinutes: 1 });
		t.tap("key-a");
		expect(t.painted.get("key-a")).toMatchObject({ state: "running", minutes: 1 });
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.focusFailures).toEqual(["key-a"]);
		expect(t.alerts.played).toEqual(["glass"]);
	});
});

/**
 * One run of the plugin process against saved state, as plugin.ts wires it: the state is loaded, the
 * controller and alert dispatcher are built on it, and `recover` runs once Stream Deck is connected.
 * Shortcuts and sounds are fakes; `log` collects info lines.
 */
async function boot(storage: StateStorage, alertSettings = {}, focusSettings = {}) {
	const lines: string[] = [];
	const ranShortcuts: string[] = [];
	const log = {
		info: (msg: string) => void lines.push(msg),
		warn: (msg: string) => void lines.push(`WARN ${msg}`),
		error: (msg: string) => void lines.push(`ERROR ${msg}`),
	};
	const store = await StateStore.open(storage, log);
	const alerts = fakeAlertPorts(alertSettings, store.alertDelivery());
	const painted = new Map<string, KeyRender>();
	const controller = new PresetController({
		clock: systemClock,
		paint: (render) => painted.set(render.keyId, render),
		alerts: alerts.dispatcher,
		focus: new FocusDispatcher({
			loadSettings: async () => focusSettings,
			shortcuts: { run: async (name) => void ranShortcuts.push(name) },
			reportFailure: () => {},
			reportSuccess: () => {},
			log,
			record: store.focusRecord(),
		}),
		log,
		store,
	});
	return { controller, painted, alerts, lines, store, ranShortcuts, tap: (keyId: string) => (controller.keyDown(keyId), controller.keyUp(keyId)) };
}

describe("navigation, reconnecting and deleted keys", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it("shows 0 on a key that comes back after its session finished on another page", async () => {
		const t = setup();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		t.controller.keyDisappeared("key-a");
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		t.painted.clear();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("keeps counting while the Neo is unplugged, alerts once, and redraws every key with 0 on reconnect", async () => {
		const t = setup();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.controller.keyAppeared("key-b", { durationMinutes: 15 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		t.controller.deviceDisconnected();
		await vi.advanceTimersByTimeAsync(4 * MIN + 50); // completes while unplugged
		expect(t.alerts.played).toEqual(["glass"]);
		t.painted.clear();
		t.controller.deviceConnected();
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.painted.get("key-b")).toMatchObject({ state: "idle", minutes: 15 });
		t.controller.deviceConnected();
		await vi.advanceTimersByTimeAsync(MIN);
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("redraws the running countdown on reconnect", async () => {
		const t = setup();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(2 * MIN);
		t.painted.clear();
		t.controller.deviceConnected();
		expect(t.painted.get("key-a")).toMatchObject({ state: "running", minutes: 3 });
	});

	it("finishes a session whose key was deleted (alerting once), and the next press anywhere starts fresh", async () => {
		const t = setup();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.controller.keyAppeared("key-b", { durationMinutes: 15 });
		t.tap("key-a");
		t.controller.keyDisappeared("key-a"); // deleted: Stream Deck reports it like a page change
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass"]);
		t.tap("key-b");
		expect(t.painted.get("key-b")).toMatchObject({ state: "running", minutes: 15 });
		await vi.advanceTimersByTimeAsync(15 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass", "glass"]);
	});

	it("finishes a restored session whose key never comes back, alerting once, and lets another key start", async () => {
		const session = { id: 4, keyId: "deleted-key", durationMs: 5 * MIN, status: "running", endsAt: 1_000_000 + 2 * MIN };
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 3, focusSessionId: 0, session }));
		const t = await boot(mem.storage);
		t.controller.recover();
		t.controller.keyAppeared("key-b", { durationMinutes: 15 });
		await vi.advanceTimersByTimeAsync(2 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass"]);
		expect(t.store.state.session).toMatchObject({ id: 4, status: "completed" });
		t.tap("key-b");
		expect(t.store.state.session).toMatchObject({ id: 5, keyId: "key-b", status: "running" });
		await vi.advanceTimersByTimeAsync(15 * MIN + 50);
		expect(t.alerts.played).toEqual(["glass", "glass"]);
	});
});

describe("recovering Focus after a restart", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it("doesn't switch Focus again for a session restored running, and ends it once when it completes", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage, {}, FOCUS_ON);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 25 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(10 * MIN);
		first.controller.stop();
		expect(first.ranShortcuts).toEqual(["Work Focus"]);

		for (let i = 0; i < 3; i++) {
			const again = await boot(mem.storage, {}, FOCUS_ON);
			again.controller.recover();
			again.controller.wake();
			again.controller.keyAppeared("key-a", { durationMinutes: 25 });
			await vi.advanceTimersByTimeAsync(MIN);
			expect(again.ranShortcuts).toEqual([]);
			again.controller.stop();
		}

		const last = await boot(mem.storage, {}, FOCUS_ON);
		last.controller.recover();
		await vi.advanceTimersByTimeAsync(15 * MIN);
		expect(last.ranShortcuts).toEqual(["Focus Off"]);
	});

	it("ends Focus once on relaunch when the session finished while the plugin was stopped, never again after", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage, {}, FOCUS_ON);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 5 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		first.controller.stop();

		await vi.advanceTimersByTimeAsync(8 * 60 * MIN); // stopped overnight
		const second = await boot(mem.storage, {}, FOCUS_ON);
		second.controller.recover();
		second.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		expect(second.ranShortcuts).toEqual(["Focus Off"]);
		expect(second.alerts.played).toEqual(["glass"]);
		second.controller.stop();

		for (let i = 0; i < 3; i++) {
			const again = await boot(mem.storage, {}, FOCUS_ON);
			again.controller.recover();
			again.controller.wake();
			await vi.advanceTimersByTimeAsync(MIN);
			expect(again.ranShortcuts).toEqual([]);
			expect(again.alerts.played).toEqual([]);
			again.controller.stop();
		}
	});

	it("ends Focus on relaunch for work cancelled just before a crash that came before its end shortcut", async () => {
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 0, focusSessionId: 4 }));
		const t = await boot(mem.storage, {}, FOCUS_ON);
		t.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		expect(t.ranShortcuts).toEqual(["Focus Off"]);
		expect(t.alerts.played).toEqual([]);
	});

	it("never ends Focus on relaunch when the end shortcut was about to run before a crash", async () => {
		const session = { id: 4, keyId: "key-a", durationMs: 5 * MIN, status: "completed" };
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 4, focusSessionId: 0, session }));
		const t = await boot(mem.storage, {}, FOCUS_ON);
		t.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		expect(t.ranShortcuts).toEqual([]);
	});

	it("still switches Focus for new sessions when the saved session counter was lost but the Focus record survived", async () => {
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: "?", lastAlertedSessionId: 0, focusSessionId: 9 }));
		const t = await boot(mem.storage, {}, FOCUS_ON);
		t.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		t.controller.keyAppeared("key-a", { durationMinutes: 1 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.ranShortcuts).toEqual(["Focus Off", "Work Focus", "Focus Off"]);
	});

	it("ends Focus once for a completion that passed during sleep, however many wake events arrive", async () => {
		const t = await boot(memoryStorage().storage, {}, FOCUS_ON);
		t.controller.recover();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(50);
		vi.setSystemTime(Date.now() + 30 * MIN);
		t.controller.wake();
		t.controller.wake();
		await vi.advanceTimersByTimeAsync(50);
		t.controller.wake();
		await vi.advanceTimersByTimeAsync(MIN);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off"]);
	});
});

describe("recovering after a restart", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it("keeps counting a running session from its original end through a plugin restart, and alerts once at the end", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 25 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(10 * MIN);
		first.controller.stop(); // plugin quits

		await vi.advanceTimersByTimeAsync(5 * MIN); // stopped for 5 minutes
		const second = await boot(mem.storage);
		second.controller.recover();
		second.controller.keyAppeared("key-a", { durationMinutes: 25 });
		expect(second.painted.get("key-a")).toMatchObject({ state: "running", minutes: 10 });
		expect(second.lines).toContainEqual(expect.stringMatching(/^restored session .*running/));

		await vi.advanceTimersByTimeAsync(10 * MIN + 50);
		expect(second.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect([...first.alerts.played, ...second.alerts.played]).toEqual(["glass"]);
	});

	it("delivers a completion missed while the plugin was stopped exactly once, across repeated restarts", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 5 });
		first.controller.keyAppeared("key-b", { durationMinutes: 15 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN);
		first.controller.stop();

		await vi.advanceTimersByTimeAsync(60 * MIN); // the end passed while stopped
		const second = await boot(mem.storage, { notificationEnabled: true });
		second.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		expect(second.alerts.played).toEqual(["glass"]);
		expect(second.alerts.notified).toHaveLength(1);
		second.controller.keyAppeared("key-a", { durationMinutes: 5 });
		second.controller.keyAppeared("key-b", { durationMinutes: 15 });
		expect(second.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(second.painted.get("key-b")).toMatchObject({ state: "idle", minutes: 15 });
		second.controller.stop();

		for (let i = 0; i < 3; i++) {
			const again = await boot(mem.storage, { notificationEnabled: true });
			again.controller.recover();
			again.controller.wake();
			again.controller.keyAppeared("key-a", { durationMinutes: 5 });
			await vi.advanceTimersByTimeAsync(MIN);
			expect(again.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
			expect(again.alerts.played).toEqual([]);
			expect(again.alerts.notified).toEqual([]);
			again.controller.stop();
		}
	});

	it("alerts a completion saved just before a crash that came before its alert", async () => {
		const session = { id: 4, keyId: "key-a", durationMs: 5 * MIN, status: "completed" };
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 3, session }));
		const t = await boot(mem.storage);
		t.controller.recover();
		t.controller.recover(); // a repeated startup signal changes nothing
		await vi.advanceTimersByTimeAsync(50);
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("never repeats an alert whose delivery was saved before a crash, even if the sound never played", async () => {
		const session = { id: 4, keyId: "key-a", durationMs: 5 * MIN, status: "running", endsAt: 500_000 };
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 4, session }));
		const t = await boot(mem.storage);
		t.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual([]);
	});

	it("delivers a completion that passed during sleep once, however many wake events arrive", async () => {
		const t = await boot(memoryStorage().storage);
		t.controller.recover();
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		t.tap("key-a");
		// Asleep: no timers fire while the wall clock moves on.
		vi.setSystemTime(Date.now() + 30 * MIN);
		t.controller.wake();
		t.controller.wake();
		await vi.advanceTimersByTimeAsync(50);
		t.controller.wake();
		await vi.advanceTimersByTimeAsync(MIN);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("restores a paused session paused, with the time it had left", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 25 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(5 * MIN);
		first.tap("key-a");
		first.controller.stop();

		await vi.advanceTimersByTimeAsync(3 * 60 * MIN);
		const second = await boot(mem.storage);
		second.controller.recover();
		second.controller.keyAppeared("key-a", { durationMinutes: 25 });
		expect(second.painted.get("key-a")).toMatchObject({ state: "paused", minutes: 20 });
		await vi.advanceTimersByTimeAsync(60 * MIN);
		expect(second.alerts.played).toEqual([]);
	});

	it("keeps a finished key cleared after a restart", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage);
		first.controller.recover();
		first.controller.keyAppeared("key-a", { durationMinutes: 1 });
		first.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);
		first.controller.keyDown("key-a");
		await vi.advanceTimersByTimeAsync(HOLD_MS + 50); // held: clear the 0
		first.controller.keyUp("key-a");
		expect(first.painted.get("key-a")).toMatchObject({ state: "idle", minutes: 1 });
		first.controller.stop();

		const second = await boot(mem.storage);
		second.controller.recover();
		second.controller.keyAppeared("key-a", { durationMinutes: 1 });
		expect(second.painted.get("key-a")).toMatchObject({ state: "idle", minutes: 1 });
	});

	it("still alerts new sessions when the saved session counter was lost but the alert record survived", async () => {
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: "?", lastAlertedSessionId: 50 }));
		const t = await boot(mem.storage);
		t.controller.recover();
		t.controller.keyAppeared("key-a", { durationMinutes: 1 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("alerts once when a key appears before the plugin finishes connecting", async () => {
		const session = { id: 4, keyId: "key-a", durationMs: 5 * MIN, status: "running", endsAt: 500_000 };
		const mem = memoryStorage(JSON.stringify({ version: 1, lastSessionId: 4, lastAlertedSessionId: 3, session }));
		const t = await boot(mem.storage);
		t.controller.keyAppeared("key-a", { durationMinutes: 5 });
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		await vi.advanceTimersByTimeAsync(50);
		t.controller.recover();
		await vi.advanceTimersByTimeAsync(50);
		expect(t.alerts.played).toEqual(["glass"]);
		// The log reports the session as it was loaded, not as the early key caught it up.
		expect(t.lines).toContain(`restored session ${JSON.stringify(session)}`);
	});

	it("in a run that can't save, alerts and switches Focus without a save error each time, after one error at startup", async () => {
		const mem = memoryStorage(JSON.stringify({ version: 2 }));
		mem.gate.moveFail = true;
		const t = await boot(mem.storage, {}, FOCUS_ON);
		t.controller.recover();
		for (const _ of [1, 2]) {
			t.controller.keyAppeared("key-a", { durationMinutes: 1 });
			t.tap("key-a");
			await vi.advanceTimersByTimeAsync(MIN + 50);
		}
		expect(t.alerts.played).toEqual(["glass", "glass"]);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off", "Work Focus", "Focus Off"]);
		expect([...t.lines.filter((l) => l.startsWith("ERROR")), ...t.alerts.errors]).toEqual([expect.stringMatching(/won't be saved/)]);
		expect(mem.writes).toEqual([]);
	});

	it("logs when there is nothing to restore", async () => {
		const t = await boot(memoryStorage().storage);
		t.controller.recover();
		expect(t.lines).toContain("no persisted session");
	});

	it("keeps the timer working when the state can't be saved", async () => {
		const mem = memoryStorage();
		mem.gate.fail = true;
		const t = await boot(mem.storage);
		t.controller.recover();
		t.controller.keyAppeared("key-a", { durationMinutes: 1 });
		t.tap("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);
		expect(t.painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(t.alerts.played).toEqual(["glass"]);
		expect(t.lines.filter((l) => l.startsWith("ERROR"))).not.toHaveLength(0);
	});
});
