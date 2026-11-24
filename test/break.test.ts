import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresetController } from "../src/actions/preset-controller";
import { parseAlertPrefs, planAlert } from "../src/core/alerts";
import { systemClock } from "../src/core/clock";
import { type KeyRender, type SessionEvent, TimerCoordinator } from "../src/core/coordinator";
import { BREAK_DEFAULT_COLOR, DEFAULT_COLOR } from "../src/core/key-style";
import { FocusDispatcher } from "../src/focus/dispatcher";
import { StateStore, type StateStorage } from "../src/persistence/store";
import { fakeAlertPorts, memoryStorage, piSource } from "./support";

const MIN = 60_000;
const FOCUS_ON = { focusEnabled: true, focusStartShortcut: "Work Focus", focusEndShortcut: "Focus Off" };
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** The plugin's wiring for one run, as plugin.ts builds it, with fake shortcuts and sounds. */
async function boot(storage: StateStorage, focusSettings: Record<string, unknown> = FOCUS_ON, alertSettings = {}) {
	const store = await StateStore.open(storage, quiet);
	const alerts = fakeAlertPorts(alertSettings, store.alertDelivery());
	const ranShortcuts: string[] = [];
	const events: SessionEvent[] = [];
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
			log: quiet,
			record: store.focusRecord(),
		}),
		log: { info: (m) => void (m.startsWith("session ") && events.push(JSON.parse(m.slice(8)))), error: () => {} },
		store,
	});
	return { controller, painted, alerts, ranShortcuts, events, store, tap: (keyId: string) => (controller.keyDown(keyId), controller.keyUp(keyId)) };
}

describe("break keys", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	it("draw in the break color until one is chosen, and in the chosen color after", () => {
		const coordinator = new TimerCoordinator(systemClock);
		const out = coordinator.keyAppeared("brk", {}, "break");
		expect(out.renders[0]?.style.color).toBe(BREAK_DEFAULT_COLOR);
		expect(coordinator.settingsChanged("brk", { color: "#1e90ff" }).renders[0]?.style.color).toBe("#1e90ff");
		expect(coordinator.settingsChanged("brk", { color: "nope" }).renders[0]?.style.color).toBe(BREAK_DEFAULT_COLOR);
		expect(coordinator.keyAppeared("work", {}).renders[0]?.style.color).toBe(DEFAULT_COLOR);
	});

	it("share the one timer with preset keys, and their events say they are breaks", async () => {
		const t = await boot(memoryStorage().storage, {});
		t.controller.keyAppeared("work", { durationMinutes: 25 });
		t.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		t.tap("work");
		t.tap("brk");
		expect(t.painted.get("work")).toMatchObject({ state: "idle", minutes: 25 });
		expect(t.painted.get("brk")).toMatchObject({ state: "running", minutes: 5 });
		t.tap("brk");
		t.tap("brk");
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.events.map((e) => [e.type, e.kind])).toEqual([
			["started", undefined],
			["replaced", "break"],
			["paused", "break"],
			["resumed", "break"],
			["completed", "break"],
		]);
		expect(t.alerts.played).toEqual(["glass"]);
	});

	it("never turn Focus on", async () => {
		const t = await boot(memoryStorage().storage);
		t.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		t.tap("brk");
		t.tap("brk");
		t.tap("brk");
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.ranShortcuts).toEqual([]);
	});

	it("end Focus when they take over from running work, and work after a break turns it on again", async () => {
		const t = await boot(memoryStorage().storage);
		t.controller.keyAppeared("work", { durationMinutes: 25 });
		t.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		t.tap("work");
		await vi.advanceTimersByTimeAsync(0);
		t.tap("brk");
		await vi.advanceTimersByTimeAsync(0);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off"]);
		t.tap("work");
		await vi.advanceTimersByTimeAsync(0);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off", "Work Focus"]);
	});

	it("leave Focus alone when they replace paused work (Focus already ended on pause)", async () => {
		const t = await boot(memoryStorage().storage);
		t.controller.keyAppeared("work", { durationMinutes: 25 });
		t.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		t.tap("work");
		t.tap("work");
		await vi.advanceTimersByTimeAsync(0);
		t.tap("brk");
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(t.ranShortcuts).toEqual(["Work Focus", "Focus Off"]);
	});

	it("carry on as breaks after a restart, and end Focus a crash left on for the work they replaced", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage);
		first.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		first.tap("brk");
		first.controller.stop();
		await first.store.update({ focusSessionId: 1, lastSessionId: 2 }); // as if work 1's end shortcut never ran
		expect(JSON.parse(mem.text()!).session).toMatchObject({ kind: "break", status: "running" });

		const second = await boot(mem.storage);
		second.controller.recover();
		await vi.advanceTimersByTimeAsync(0);
		expect(second.ranShortcuts).toEqual(["Focus Off"]);
		await vi.advanceTimersByTimeAsync(5 * MIN + 50);
		expect(second.ranShortcuts).toEqual(["Focus Off"]);
		expect(second.events).toContainEqual(expect.objectContaining({ type: "completed", kind: "break" }));
	});

	it("deliver a missed break's alert with the break text after a restart", async () => {
		const mem = memoryStorage();
		const first = await boot(mem.storage, {}, { notificationEnabled: true });
		first.controller.keyAppeared("brk", { durationMinutes: 5 }, "break");
		first.tap("brk");
		first.controller.stop();
		await vi.advanceTimersByTimeAsync(10 * MIN);

		const second = await boot(mem.storage, {}, { notificationEnabled: true });
		second.controller.recover();
		await vi.advanceTimersByTimeAsync(0);
		expect(second.alerts.notified).toEqual([{ title: "Focus Keys", body: "Break's over: 5-minute break finished." }]);
	});
});

describe("break alerts", () => {
	it("use the break text when no text was chosen", () => {
		expect(planAlert(parseAlertPrefs({ notificationEnabled: true }), 5 * MIN, "break").notification?.body).toBe("Break's over: 5-minute break finished.");
		expect(planAlert(parseAlertPrefs({ notificationEnabled: true }), 5 * MIN).notification?.body).toBe("Time's up: 5-minute timer finished.");
	});

	it("use the user's own text for breaks too", () => {
		expect(planAlert(parseAlertPrefs({ notificationEnabled: true, notificationText: "Done" }), 5 * MIN, "break").notification?.body).toBe("Done");
	});
});

describe("saved break sessions", () => {
	it("read back as breaks; anything else reads as a focus session", async () => {
		const save = (kind: unknown) =>
			JSON.stringify({ version: 1, lastSessionId: 3, session: { id: 3, keyId: "k", durationMs: MIN, status: "paused", remainingMs: 1, kind } });
		expect((await StateStore.open(memoryStorage(save("break")).storage, quiet)).state.session).toMatchObject({ kind: "break" });
		const other = (await StateStore.open(memoryStorage(save("lunch")).storage, quiet)).state.session;
		expect(other).toBeDefined();
		expect(other).not.toHaveProperty("kind");
	});
});

describe("Property Inspector", () => {
	it("says Break keys never switch Focus", () => {
		expect(piSource()).toMatch(/Break keys never\s+switch Focus on/);
	});
});
