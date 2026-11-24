import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresetController } from "../src/actions/preset-controller";
import { HOLD_MS, type KeyRender } from "../src/core/coordinator";
import { systemClock } from "../src/core/clock";
import { fakeAlertPorts } from "./support";

const MIN = 60_000;

/**
 * The plugin's wiring without the Stream Deck SDK: key events in, painted keys and alerts out, driven by
 * the real wake timer under vitest's fake timers (which also fake Date.now, read by the system clock).
 */
function setup(settings = {}) {
	const alerts = fakeAlertPorts(settings);
	const painted = new Map<string, KeyRender>();
	const controller = new PresetController({
		clock: systemClock,
		paint: (render) => painted.set(render.keyId, render),
		alerts: alerts.dispatcher,
		log: { info: () => {}, error: () => {} },
	});
	return { controller, painted, alerts, tap: (keyId: string) => (controller.keyDown(keyId), controller.keyUp(keyId)) };
}

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
			log: { info: () => {}, error: (msg) => void errors.push(msg) },
		});
		controller.keyAppeared("key-a", { durationMinutes: 1 });
		controller.keyDown("key-a");
		controller.keyUp("key-a");
		await vi.advanceTimersByTimeAsync(MIN + 50);

		expect(painted.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
		expect(errors.length).toBeGreaterThan(0);
	});
});
