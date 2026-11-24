import { describe, expect, it } from "vitest";

import { HOLD_MS, TimerCoordinator, type KeyRender, type Output, type PresetSettings, type SessionEvent } from "../src/core/coordinator";
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
/** What a key with no color or font settings is drawn with. */
const DEFAULT_STYLE = { color: "#ff6347", font: "inter" };

function setup() {
	const clock = new ManualClock();
	const coordinator = new TimerCoordinator(clock);
	/** What each key currently shows: the latest render the coordinator sent for it. */
	const display = new Map<string, KeyRender>();
	/** Every session transition the coordinator has reported, in order. */
	const events: SessionEvent[] = [];
	const apply = (out: Output) => {
		for (const r of out.renders) display.set(r.keyId, r);
		events.push(...out.events);
		return out;
	};
	const merge = (a: Output, b: Output): Output => ({ renders: [...a.renders, ...b.renders], events: [...a.events, ...b.events] });
	return {
		clock,
		coordinator,
		display,
		events,
		apply,
		appear: (keyId: string, settings: PresetSettings = {}) => apply(coordinator.keyAppeared(keyId, settings)),
		/** A quick tap: key down and up at the same instant. */
		press: (keyId: string) => merge(apply(coordinator.keyDown(keyId)), apply(coordinator.keyUp(keyId))),
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

		expect(out.renders).toEqual([{ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE }]);
	});
});

describe("preset duration setting", () => {
	it.each([[0], [-3], [2.5], [181], [Number.NaN], [""], ["abc"]])("falls back to 5 for an unusable value (%s)", (value) => {
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

		coordinator.keyDown("key-a");
		const out = coordinator.keyUp("key-a");

		expect(out.renders).toEqual([{ keyId: "key-a", state: "running", minutes: 5, ring: 1, style: DEFAULT_STYLE }]);
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
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0, style: DEFAULT_STYLE });

		t.elapse(30 * MIN);
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0, style: DEFAULT_STYLE });
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

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "running", minutes: 5, ring: 1, style: DEFAULT_STYLE });
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
		expect(t.elapse(1).renders).toEqual([{ keyId: "key-a", state: "running", minutes: 4, ring: 0.8, style: DEFAULT_STYLE }]);
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

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "running", minutes: 5, ring: 1, style: DEFAULT_STYLE });
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
		expect(t.elapse(MIN).renders).toEqual([{ keyId: "key-a", state: "running", minutes: 4, ring: 0.8, style: DEFAULT_STYLE }]);
	});
});

describe("one timer across keys", () => {
	it("runs only the most recently pressed key; the other returns to its idle number", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);

		t.press("key-b");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.display.get("key-b")).toEqual({ keyId: "key-b", state: "running", minutes: 15, ring: 1, style: DEFAULT_STYLE });
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

describe("tapping the active key", () => {
	it("pauses a running countdown at its current minutes and progress", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(90_000);

		t.press("key-a");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "paused", minutes: 4, ring: 0.7, style: DEFAULT_STYLE });
		expect(t.events.at(-1)).toEqual({ type: "paused", keyId: "key-a", sessionId: 1 });
	});
});

describe("resuming a paused key", () => {
	it("stays frozen while paused, then counts down the remaining time after a tap", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(90_000);
		t.press("key-a");

		expect(t.coordinator.nextChangeAt()).toBeUndefined();
		expect(t.elapse(60 * MIN).renders).toEqual([]);

		t.press("key-a");
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "running", minutes: 4, ring: 0.7, style: DEFAULT_STYLE });
		expect(t.events.at(-1)).toEqual({ type: "resumed", keyId: "key-a", sessionId: 1 });

		t.elapse(30_000 - 1);
		expect(t.display.get("key-a")).toMatchObject({ minutes: 4 });
		t.elapse(1);
		expect(t.display.get("key-a")).toMatchObject({ minutes: 3 });
		t.elapse(3 * MIN);
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0, style: DEFAULT_STYLE });
	});
});

describe("holding a key", () => {
	/** Puts a key down and lets the plugin's wake timer fire at the moment the coordinator asked for. */
	function holdUntilWake(t: ReturnType<typeof setup>, keyId: string) {
		t.apply(t.coordinator.keyDown(keyId));
		const wakeAt = t.coordinator.nextChangeAt();
		expect(wakeAt).toBe(t.clock.now() + HOLD_MS);
		t.elapse(HOLD_MS);
	}

	it.each([["running"], ["paused"]])("cancels a %s session at the hold threshold, before release, then release does nothing", (state) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);
		if (state === "paused") t.press("key-a");

		holdUntilWake(t, "key-a");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 15, style: DEFAULT_STYLE });
		expect(t.events.at(-1)).toEqual({ type: "cancelled", keyId: "key-a", sessionId: 1 });

		const release = t.apply(t.coordinator.keyUp("key-a"));
		expect(release).toEqual({ renders: [], events: [] });
		expect(t.coordinator.nextChangeAt()).toBeUndefined();
	});

	it("does not cancel when released just before the threshold; that is a tap", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(HOLD_MS - 1);
		expect(t.display.get("key-a")).toMatchObject({ state: "running" });

		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toMatchObject({ state: "paused" });
	});

	it("still cancels on release if the threshold passed without a wake-up", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.apply(t.coordinator.keyDown("key-a"));
		t.clock.advance(HOLD_MS + 200);

		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "cancelled"]);
	});

	it("clears a finished key back to its idle number without reporting a transition", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN);

		holdUntilWake(t, "key-a");
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed"]);
	});

	it("reports a completion that happens mid-hold, then clears the finished key at the threshold", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN - 300);

		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(300);
		expect(t.display.get("key-a")).toMatchObject({ state: "done" });
		t.elapse(HOLD_MS - 300);

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed"]);
	});

	it("does nothing on an idle key, or on a key other than the active one", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.apply(t.coordinator.keyDown("key-a"));
		expect(t.coordinator.nextChangeAt()).toBeUndefined();
		t.elapse(2_000);
		t.apply(t.coordinator.keyUp("key-a"));
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });

		t.press("key-b");
		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(2_000);
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.display.get("key-b")).toMatchObject({ state: "running", minutes: 15 });
		expect(t.events.map((e) => e.type)).toEqual(["started"]);
	});
});

describe("selecting another preset", () => {
	it.each([["running"], ["paused"]])("replaces a %s session without a completion or cancellation", (state) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 5 });
		t.appear("key-b", { durationMinutes: 30 });
		t.press("key-a");
		t.elapse(2 * MIN);
		if (state === "paused") t.press("key-a");

		t.press("key-b");
		t.elapse(5 * MIN); // well past where key-a would have finished

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.display.get("key-b")).toMatchObject({ state: "running", minutes: 25 });
		expect(t.events.at(-1)).toEqual({ type: "replaced", keyId: "key-b", sessionId: 2, durationMs: 30 * MIN, fromKeyId: "key-a", fromState: state });
		expect(t.events.map((e) => e.type)).not.toContain("completed");
		expect(t.events.map((e) => e.type)).not.toContain("cancelled");
	});

	it("starts normally after a finished session, leaving the finished key idle", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(5 * MIN);

		t.press("key-b");

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed", "started"]);
	});
});

describe("session events", () => {
	it("reports completion exactly once, however many ticks follow", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN);
		t.elapse(MIN);
		t.elapse(0);

		expect(t.events).toEqual([
			{ type: "started", keyId: "key-a", sessionId: 1, durationMs: 5 * MIN },
			{ type: "completed", keyId: "key-a", sessionId: 1, durationMs: 5 * MIN },
		]);
	});

	it("identifies each completed session separately, so an alert can be delivered once per session", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN);
		t.press("key-a"); // restart the finished key
		t.elapse(5 * MIN);

		const ids = t.events.flatMap((e) => (e.type === "completed" ? [e.sessionId] : []));
		expect(ids).toHaveLength(2);
		expect(ids[1]).toBeGreaterThan(ids[0]);
	});

	it("tags every transition with its session, and a replacement starts a new session", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b");
		t.press("key-a");
		t.press("key-a"); // pause
		t.press("key-a"); // resume
		t.press("key-b"); // replaces key-a's session
		t.apply(t.coordinator.keyDown("key-b"));
		t.elapse(HOLD_MS); // held: cancels key-b's session
		t.apply(t.coordinator.keyUp("key-b"));

		const [a, , , b] = t.events.map((e) => e.sessionId);
		expect(t.events.map((e) => [e.type, e.sessionId])).toEqual([
			["started", a],
			["paused", a],
			["resumed", a],
			["replaced", b],
			["cancelled", b],
		]);
		expect(b).toBeGreaterThan(a);
	});

	it("reports no completion for a session that was cancelled or replaced, even after its end time", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);
		t.press("key-b"); // replaces key-a's session
		t.elapse(5 * MIN);
		t.apply(t.coordinator.keyDown("key-b"));
		t.elapse(HOLD_MS); // held: cancels key-b's session
		t.apply(t.coordinator.keyUp("key-b"));
		t.elapse(20 * MIN);

		expect(t.events.map((e) => e.type)).toEqual(["started", "replaced", "cancelled"]);
	});
});

describe("four presets", () => {
	it("each key shows its own configured duration when idle", () => {
		const t = setup();
		[5, 15, 30, 60].forEach((m, i) => t.appear(`key-${i}`, { durationMinutes: m }));

		expect([0, 1, 2, 3].map((i) => t.display.get(`key-${i}`))).toEqual([
			{ keyId: "key-0", state: "idle", minutes: 5, style: DEFAULT_STYLE },
			{ keyId: "key-1", state: "idle", minutes: 15, style: DEFAULT_STYLE },
			{ keyId: "key-2", state: "idle", minutes: 30, style: DEFAULT_STYLE },
			{ keyId: "key-3", state: "idle", minutes: 60, style: DEFAULT_STYLE },
		]);
	});

	it("accepts a duration saved as text by the Property Inspector", () => {
		const t = setup();
		t.appear("key-a", { durationMinutes: "45" });
		expect(t.display.get("key-a")).toMatchObject({ state: "idle", minutes: 45 });
	});

	it.each([5, 15, 30, 60])("a %i-minute session changes minutes exactly at every whole-minute boundary", (preset) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: preset });
		t.press("key-a");
		for (let left = preset; left >= 1; left--) {
			// Just after the boundary above `left`, and exactly at `left - 1` minutes remaining.
			t.elapse(MIN - 1);
			expect(t.display.get("key-a")).toMatchObject({ minutes: left });
			t.elapse(1);
			expect(t.display.get("key-a")).toMatchObject({ minutes: left - 1, state: left === 1 ? "done" : "running" });
		}
	});
});

describe("editing a key's duration", () => {
	it("updates an idle key's number immediately", () => {
		const t = setup();
		t.appear("key-a");

		t.apply(t.coordinator.settingsChanged("key-a", { durationMinutes: 25 }));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 25, style: DEFAULT_STYLE });
	});

	it("keeps the previous duration when the new value is unusable", () => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 15 });

		t.apply(t.coordinator.settingsChanged("key-a", { durationMinutes: "" }));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 15, style: DEFAULT_STYLE });
		expect(t.coordinator.presetMinutes("key-a")).toBe(15); // what the plugin writes back to settings
	});

	it.each([["running"], ["paused"]])("leaves a %s session's countdown alone and applies the new duration to the next start", (state) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);
		if (state === "paused") t.press("key-a");

		const out = t.apply(t.coordinator.settingsChanged("key-a", { durationMinutes: 1 }));

		expect(out).toEqual({ renders: [], events: [] });
		expect(t.display.get("key-a")).toMatchObject({ state, minutes: 14 });

		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(HOLD_MS);
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 1, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).not.toContain("completed");
	});
});

describe("a tap whose session changed while the key was down", () => {
	it("does nothing beyond the completion when the session finishes before release", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.elapse(5 * MIN - 200);

		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(200);
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed"]);
	});

	it("does nothing beyond the completion when a late wake-up finds the session already over (e.g. after sleep)", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.clock.advance(2 * 60 * MIN); // no tick: the key still shows running when pressed

		t.apply(t.coordinator.keyDown("key-a"));
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "done", minutes: 0, style: DEFAULT_STYLE });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed"]);
	});

	it.each([["running"], ["paused"], ["finished"]])("does nothing when another key replaced its %s session before release", (state) => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN);
		if (state === "paused") t.press("key-a");
		if (state === "finished") t.elapse(4 * MIN);

		t.apply(t.coordinator.keyDown("key-a"));
		t.press("key-b");
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
		expect(t.display.get("key-b")).toMatchObject({ state: "running", minutes: 15 });
	});

	it("still starts a key that was idle when pressed, even if the other key's session finished meanwhile", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15 });
		t.press("key-b");
		t.elapse(15 * MIN - 200);

		t.apply(t.coordinator.keyDown("key-a"));
		t.elapse(200);
		t.apply(t.coordinator.keyUp("key-a"));

		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 5 });
		expect(t.events.map((e) => e.type)).toEqual(["started", "completed", "started"]);
	});
});

describe("unexpected key events", () => {
	it("ignores a key-up with no matching key-down", () => {
		const t = setup();
		t.appear("key-a");

		const out = t.apply(t.coordinator.keyUp("key-a"));

		expect(out).toEqual({ renders: [], events: [] });
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 5, style: DEFAULT_STYLE });
	});

	it("drops a hold whose key disappears mid-press, without cancelling the session", () => {
		const t = setup();
		t.appear("key-a");
		t.press("key-a");
		t.apply(t.coordinator.keyDown("key-a"));

		t.coordinator.keyDisappeared("key-a");
		t.elapse(HOLD_MS);
		t.apply(t.coordinator.keyUp("key-a"));
		t.appear("key-a");

		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 5 });
		expect(t.events.map((e) => e.type)).toEqual(["started"]);
	});

	it("ignores a settings change for a key that is not visible", () => {
		const t = setup();
		t.appear("key-a");
		t.coordinator.keyDisappeared("key-a");

		const out = t.apply(t.coordinator.settingsChanged("key-a", { durationMinutes: 25 }));

		expect(out).toEqual({ renders: [], events: [] });
		t.appear("key-a", { durationMinutes: 10 });
		expect(t.display.get("key-a")).toEqual({ keyId: "key-a", state: "idle", minutes: 10, style: DEFAULT_STYLE });
	});
});

describe("key appearance", () => {
	it("draws a new key in the default color and font, and its saved ones when set", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b", { durationMinutes: 15, color: "#1e90ff", font: "oswald" });

		expect(t.display.get("key-a")).toMatchObject({ style: { color: "#ff6347", font: "inter" } });
		expect(t.display.get("key-b")).toMatchObject({ minutes: 15, style: { color: "#1e90ff", font: "oswald" } });
	});

	it.each([["idle"], ["running"], ["paused"], ["done"]])("restyles a %s key at once without touching the timer", (state) => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 15 });
		if (state !== "idle") t.press("key-a");
		t.elapse(MIN + 30_000);
		if (state === "paused") t.press("key-a");
		if (state === "done") t.elapse(15 * MIN);
		const before = t.display.get("key-a")!;
		const eventCount = t.events.length;

		const out = t.apply(t.coordinator.settingsChanged("key-a", { durationMinutes: 15, color: "#32cd32", font: "bitter" }));

		expect(out.events).toEqual([]);
		expect(out.renders).toEqual([{ ...before, style: { color: "#32cd32", font: "bitter" } }]);
		expect(t.events.length).toBe(eventCount);
		// The timer carries on exactly as before: same remaining time, same next step.
		if (state === "running") {
			t.elapse(29_999);
			expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 14 });
			t.elapse(1);
			expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 13, style: { font: "bitter" } });
		}
		if (state === "paused") {
			t.press("key-a");
			expect(t.events.at(-1)).toEqual({ type: "resumed", keyId: "key-a", sessionId: 1 });
		}
	});

	it("restyles only the edited key", () => {
		const t = setup();
		t.appear("key-a");
		t.appear("key-b");
		t.press("key-b");

		const out = t.apply(t.coordinator.settingsChanged("key-a", { color: "#ffd700" }));

		expect(out.renders.map((r) => r.keyId)).toEqual(["key-a"]);
		expect(t.display.get("key-a")).toMatchObject({ state: "idle", minutes: 5, style: { color: "#ffd700" } });
		expect(t.coordinator.presetMinutes("key-a")).toBe(5);
		expect(t.display.get("key-b")).toMatchObject({ state: "running", style: { color: "#ff6347" } });
	});

	it("keeps a running key's duration and countdown when settings carry only a new color", () => {
		const t = setup();
		t.appear("key-a", { durationMinutes: 15 });
		t.press("key-a");
		t.elapse(MIN + 30_000);
		const before = t.display.get("key-a")!;
		const wakeAt = t.coordinator.nextChangeAt();

		const out = t.apply(t.coordinator.settingsChanged("key-a", { color: "#ffd700" }));

		expect(out).toEqual({ renders: [{ ...before, style: { ...DEFAULT_STYLE, color: "#ffd700" } }], events: [] });
		expect(t.display.get("key-a")).toMatchObject({ state: "running", minutes: 14 });
		expect(t.coordinator.nextChangeAt()).toBe(wakeAt);
		expect(t.coordinator.presetMinutes("key-a")).toBe(15);
	});

	it("does not redraw when saved settings leave the look unchanged", () => {
		const t = setup();
		t.appear("key-a", { color: "#1e90ff", font: "nunito" });

		expect(t.coordinator.settingsChanged("key-a", { color: "#1E90FF", font: "nunito" })).toEqual({ renders: [], events: [] });
	});
});
