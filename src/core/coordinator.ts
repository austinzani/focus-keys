import type { Clock } from "./clock";

/** Per-key settings, shaped like the Stream Deck action settings that later issues will make editable. */
export type PresetSettings = { durationMinutes?: number };

export type KeyRender =
	| { keyId: string; state: "idle"; minutes: number }
	| { keyId: string; state: "running"; minutes: number; ring: number }
	| { keyId: string; state: "done"; minutes: 0 };

/** System effects the plugin edge should perform. Alerts and Focus effects arrive in later issues. */
export type Effect = never;

export type Output = { renders: KeyRender[]; effects: Effect[] };

export const DEFAULT_DURATION_MINUTES = 5;
/** Ring resolution: the arc changes in 1/RING_STEPS increments of the session, which bounds key redraws. */
export const RING_STEPS = 120;
const MINUTE_MS = 60_000;

/** The single shared session. A running session stores its absolute end time, never a decrementing counter. */
type Session = { keyId: string; durationMs: number; endsAt: number; completed: boolean };

/**
 * Application boundary for the timer. Stream Deck events and clock changes go in;
 * per-key render descriptions and requested system effects come out. No SDK imports.
 */
export class TimerCoordinator {
	readonly #keys = new Map<string, PresetSettings>();
	/** The render each visible key last received, so unchanged keys are not redrawn. */
	readonly #shown = new Map<string, KeyRender>();
	#session: Session | undefined;

	constructor(private readonly clock: Clock) {}

	keyAppeared(keyId: string, settings: PresetSettings): Output {
		this.#keys.set(keyId, settings);
		this.#shown.delete(keyId);
		return this.#output();
	}

	/** Re-evaluates every visible key against the current clock time. */
	tick(): Output {
		return this.#output();
	}

	keyDisappeared(keyId: string): void {
		this.#keys.delete(keyId);
		this.#shown.delete(keyId);
	}

	/**
	 * A press on a running key is ignored for now (pause/resume is AUS-1880).
	 * Any other press, including on a finished key, starts a fresh session on that key.
	 */
	keyPressed(keyId: string): Output {
		this.#advance();
		if (this.#runningSession()?.keyId === keyId) return this.#output();
		const durationMs = this.#durationMinutes(keyId) * MINUTE_MS;
		this.#session = { keyId, durationMs, endsAt: this.clock.now() + durationMs, completed: false };
		return this.#output();
	}

	/**
	 * Epoch ms at which some key's appearance next changes (ring step, minute boundary, or completion);
	 * `undefined` when nothing is running. May be in the past if a change is overdue.
	 */
	nextChangeAt(): number | undefined {
		const session = this.#runningSession();
		if (session === undefined) return undefined;
		const remainingMs = this.#remainingMs(session);
		if (remainingMs <= 0) return session.endsAt;
		const stepMs = session.durationMs / RING_STEPS;
		const nextRingStep = session.endsAt - (Math.ceil(remainingMs / stepMs) - 1) * stepMs;
		const nextMinute = session.endsAt - (Math.ceil(remainingMs / MINUTE_MS) - 1) * MINUTE_MS;
		return Math.min(nextRingStep, nextMinute);
	}

	/** Applies time-driven transitions; completion side effects will attach here in later issues. */
	#advance(): void {
		const session = this.#runningSession();
		if (session && this.clock.now() >= session.endsAt) session.completed = true;
	}

	/**
	 * Time left until the absolute end, clamped to [0, duration]. A wall clock moved backward extends the
	 * session, but the display never shows more than the preset.
	 */
	#remainingMs(session: Session): number {
		return Math.min(Math.max(session.endsAt - this.clock.now(), 0), session.durationMs);
	}

	#runningSession(): Session | undefined {
		return this.#session?.completed === false ? this.#session : undefined;
	}

	/** Renders every visible key whose appearance differs from what it last showed. */
	#output(): Output {
		this.#advance();
		const renders: KeyRender[] = [];
		for (const keyId of this.#keys.keys()) {
			const render = this.#renderFor(keyId);
			if (!sameRender(this.#shown.get(keyId), render)) {
				this.#shown.set(keyId, render);
				renders.push(render);
			}
		}
		return { renders, effects: [] };
	}

	#durationMinutes(keyId: string): number {
		const value = this.#keys.get(keyId)?.durationMinutes;
		return Number.isInteger(value) && (value as number) > 0 ? (value as number) : DEFAULT_DURATION_MINUTES;
	}

	#renderFor(keyId: string): KeyRender {
		const session = this.#session;
		if (session?.keyId === keyId) {
			if (session.completed) return { keyId, state: "done", minutes: 0 };
			const remainingMs = this.#remainingMs(session);
			return { keyId, state: "running", minutes: Math.ceil(remainingMs / MINUTE_MS), ring: ringFraction(remainingMs, session.durationMs) };
		}
		return { keyId, state: "idle", minutes: this.#durationMinutes(keyId) };
	}
}

/** Remaining fraction rounded up to the next ring step, so the ring is full at start and empty only at completion. */
function ringFraction(remainingMs: number, durationMs: number): number {
	return Math.ceil((remainingMs / durationMs) * RING_STEPS) / RING_STEPS;
}

function sameRender(a: KeyRender | undefined, b: KeyRender): boolean {
	return a !== undefined && a.state === b.state && a.minutes === b.minutes && ringOf(a) === ringOf(b);
}

function ringOf(render: KeyRender): number | undefined {
	return render.state === "running" ? render.ring : undefined;
}
