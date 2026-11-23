import { describe, expect, it } from "vitest";

import { TimerCoordinator, type Effect, type KeyRender, type Output, type PresetSettings } from "../src/core/coordinator";
import type { Clock } from "../src/core/clock";

class ManualClock implements Clock {
	constructor(private ms = 1_000_000) {}
	now(): number {
		return this.ms;
	}
	advance(ms: number): void {
		this.ms += ms;
	}
}

const MIN = 60_000;

function setup() {
	const clock = new ManualClock();
	const coordinator = new TimerCoordinator(clock);
	/** What each key currently shows: the latest render the coordinator sent for it. */
	const display = new Map<string, KeyRender>();
	const effects: Effect[] = [];
	const apply = (out: Output) => {
		for (const r of out.renders) display.set(r.keyId, r);
		effects.push(...out.effects);
		return out;
	};
	return {
		clock,
		coordinator,
		display,
		effects,
		appear: (keyId: string, settings: PresetSettings = {}) => apply(coordinator.keyAppeared(keyId, settings)),
		press: (keyId: string) => apply(coordinator.keyPressed(keyId)),
		/** Moves the clock forward and lets the coordinator observe it, as the plugin's timer would. */
		elapse: (ms: number) => {
			clock.advance(ms);
			return apply(coordinator.tick());
		},
	};
}

describe("idle preset key", () => {
	it("shows its default duration of 5 when it appears", () => {
		const { coordinator } = setup();

		const out = coordinator.keyAppeared("key-a", {});

		expect(out.renders).toEqual([{ keyId: "key-a", state: "idle", minutes: 5 }]);
	});
});

describe("preset duration setting", () => {
	it.each([[0], [-3], [Number.NaN], ["15" as unknown as number]])("falls back to 5 for an unusable value (%s)", (value) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: value });
		expect(t.display.get("key-a")).toMatchObject({ state: "idle", minutes: 5 });

		t.press("key-a");
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 5, ring: 1 });
		expect(t.coordinator.nextChangeAt()).toBe(t.clock.now() + 2_500);
	});
});

describe("pressing an idle key", () => {
	it("starts a running countdown showing 5 with a full ring", () => {
		const { coordinator } = setup();
		coordinator.keyAppeared("key-a", {});

		const out = coordinator.keyPressed("key-a");

		expect(out.renders).toEqual([{ keyId: "key-a", state: "running", minutes: 5, ring: 1 }]);
	});
});

describe("whole-minute countdown", () => {
	it.each([
		["5:00 remaining", 0, 5],
		["4:59 remaining", 1_000, 5],
		["4:00.001 remaining", MIN - 1, 5],
		["exactly 4:00 remaining", MIN, 4],
		["0:01 remaining", 5 * MIN - 1_000, 1],
		["1 ms remaining", 5 * MIN - 1, 1],
	])("shows minutes rounded up with %s", (_label, elapsedMs, expected) => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");

		t.elapse(elapsedMs);

		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: expected });
	});
});

describe("completion", () => {
	it("shows 0 with no ring once the full duration has elapsed, and keeps showing it", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");

		t.elapse(5 * MIN);
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0 });

		t.elapse(30 * MIN);
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0 });
	});

	it("shows 0 when the clock jumps well past the end (e.g. after sleep)", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");

		t.elapse(2 * 60 * MIN);

		expect(t.display.get("key-a")).toMatchObject({ state: "done", minutes: 0 });
	});

	it("starts a fresh full session when the finished key is pressed", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN);

		t.press("key-a");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "running", minutes: 5, ring: 1 });
		t.elapse(MIN);
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 4 });
	});
});

describe("running ring", () => {
	it("shrinks with the remaining fraction of the session", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");

		t.elapse(2.5 * MIN);
		expect(t.display.get("key-a")).toMatchObject({ minutes: 3, ring: 0.5 });

		t.elapse(2.25 * MIN);
		expect(t.display.get("key-a")).toMatchObject({ minutes: 1, ring: 0.05 });
	});

	it("does not resend a key whose visible state has not changed", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b");
		t.press("key-a");

		expect(t.elapse(100).renders).toEqual([]);
	});
});

describe("redraw scheduling", () => {
	it("needs no wake-ups while nothing is running", () => {
		const t = setup();
		t.appear("key-a");

		expect(t.coordinator.nextChangeAt()).toBeUndefined();
	});

	it("asks to be woken exactly when the next ring step or minute boundary is reached", () => {
		const t = setup();
		t.appear("key-a");
		const start = t.clock.now();
		t.press("key-a");

		// 5-minute session / 120 ring steps = one step every 2.5 s.
		expect(t.coordinator.nextChangeAt()).toBe(start + 2_500);

		t.elapse(MIN - 1_000); // 4:01 remaining: next step lands on the 4:00 minute boundary
		expect(t.coordinator.nextChangeAt()).toBe(start + MIN);
		expect(t.elapse(999).renders).toEqual([]);
		expect(t.elapse(1).renders).toEqual([{ keyId: "key-a", state: "running", minutes: 4, ring: 0.8 }]);
	});

	it("asks to be woken at completion for the final step, then stops", () => {
		const t = setup();
		t.appear("key-a");
		const start = t.clock.now();
		t.press("key-a");

		t.elapse(5 * MIN - 2_000);
		expect(t.coordinator.nextChangeAt()).toBe(start + 5 * MIN);

		t.elapse(2_000);
		expect(t.coordinator.nextChangeAt()).toBeUndefined();
	});

	it("wakes immediately when a scheduled change is already overdue", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");

		t.clock.advance(10 * MIN);

		expect(t.coordinator.nextChangeAt()).toBeLessThanOrEqual(t.clock.now());
	});
});

describe("wall clock moving backward", () => {
	it("never shows more than the preset minutes or more than a full ring", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(2 * MIN);
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 3 });

		t.elapse(-10 * MIN);

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "running", minutes: 5, ring: 1 });
	});

	it("extends the session: the countdown resumes from the preset once the clock catches up", () => {
		const t = setup();
		t.appear("key-a");
		const start = t.clock.now();
		t.press("key-a");
		t.elapse(-10 * MIN);

		// Display stays at the full preset until the original start time; the first change is one ring step later.
		expect(t.coordinator.nextChangeAt()).toBe(start + 2_500);
		expect(t.elapse(10 * MIN).renders).toEqual([]);
		expect(t.elapse(MIN).renders).toEqual([{ keyId: "key-a", state: "running", minutes: 4, ring: 0.8 }]);
	});
});

describe("one timer across keys", () => {
	it("keeps the countdown going when the running key is pressed again (pause arrives later)", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(MIN);

		expect(t.press("key-a").renders).toEqual([]);
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 4 });
	});

	it("runs only the most recently pressed key; the other returns to its idle number", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);

		t.press("key-b");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5 });
		expect(t.display.get("key-b")).toEqual({ keyId: "key-b", state: "running", minutes: 15, ring: 1 });
	});

	it("shows the live countdown when a running key reappears (page or profile switch)", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.coordinator.keyDisappeared("key-a");

		t.elapse(2 * MIN);
		expect(t.display.get("key-a")).toMatchObject({ minutes: 5 }); // hidden keys receive nothing

		t.appear("key-a");
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 3 });
	});
});
