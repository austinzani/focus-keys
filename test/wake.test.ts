import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WakeTimer } from "../src/actions/wake-timer";
import { systemClock } from "../src/core/clock";

describe("wake timer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
	});
	afterEach(() => vi.useRealTimers());

	// vitest's fake timers also fake Date.now, which the system clock reads.
	it("fires just after the requested moment, not before", () => {
		const onWake = vi.fn();
		const wake = new WakeTimer(systemClock, onWake);

		wake.schedule(1_000_000 + 600);

		vi.advanceTimersByTime(600);
		expect(onWake).not.toHaveBeenCalled();
		vi.advanceTimersByTime(WakeTimer.MARGIN_MS);
		expect(onWake).toHaveBeenCalledTimes(1);
	});

	it("fires promptly when the moment is already overdue", () => {
		const onWake = vi.fn();
		const wake = new WakeTimer(systemClock, onWake);

		wake.schedule(1_000_000 - 5_000);

		vi.advanceTimersByTime(WakeTimer.MARGIN_MS);
		expect(onWake).toHaveBeenCalledTimes(1);
	});

	it("keeps only the latest request, and nothing when there is nothing to wait for", () => {
		const onWake = vi.fn();
		const wake = new WakeTimer(systemClock, onWake);

		wake.schedule(1_000_000 + 10_000);
		wake.schedule(1_000_000 + 1_000);
		vi.advanceTimersByTime(2_000);
		expect(onWake).toHaveBeenCalledTimes(1);

		wake.schedule(1_000_000 + 60_000);
		wake.schedule(undefined);
		vi.advanceTimersByTime(120_000);
		expect(onWake).toHaveBeenCalledTimes(1);
	});
});
