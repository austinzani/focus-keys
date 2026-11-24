import type { Clock } from "../core/clock";

/**
 * One pending wake-up at an absolute moment. Each request replaces the previous one, so the plugin
 * runs a single timer for the countdown and any hold in progress.
 */
export class WakeTimer {
	/** Small margin so a wake-up lands just after the requested moment, never just before it. */
	static readonly MARGIN_MS = 5;
	#handle: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly clock: Clock,
		private readonly onWake: () => void,
	) {}

	/** Wakes at epoch ms `at` (immediately if overdue), or cancels the pending wake-up when `undefined`. */
	schedule(at: number | undefined): void {
		clearTimeout(this.#handle);
		this.#handle = undefined;
		if (at === undefined) return;
		const delay = Math.max(0, at - this.clock.now()) + WakeTimer.MARGIN_MS;
		this.#handle = setTimeout(() => {
			this.#handle = undefined;
			this.onWake();
		}, delay);
	}
}
