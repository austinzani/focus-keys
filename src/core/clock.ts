/** Source of wall-clock time in epoch milliseconds. Injected so tests control time. */
export interface Clock {
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
