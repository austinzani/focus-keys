import { type KeyStyle, parseKeyStyle } from "./key-style";
import type { Clock } from "./clock";

/**
 * Per-key settings as stored by the Stream Deck action. The Property Inspector's text field saves strings,
 * so a duration may arrive as either a number or a numeric string. `color` and `font` only change the key's look.
 */
export type PresetSettings = { durationMinutes?: number | string; color?: string; font?: string };

/** What one key should show. `style` is the key's own color and font, independent of the timer. */
export type KeyRender = (
	| { keyId: string; state: "idle"; minutes: number }
	| { keyId: string; state: "running"; minutes: number; ring: number }
	| { keyId: string; state: "paused"; minutes: number; ring: number }
	| { keyId: string; state: "done"; minutes: 0 }
) & { style: KeyStyle };

/**
 * Session transitions, reported once each, for alert and Focus integrations to hook into. `completed`
 * carries the session's id (increasing with each start, within this process) so its alert can be delivered once.
 * Replacing a running or paused session with another preset reports only `replaced`, never `completed` or
 * `cancelled`; `replaced` also starts the new session, so treat it as a start for `keyId`.
 */
export type SessionEvent =
	| { type: "started"; keyId: string; durationMs: number }
	| { type: "paused"; keyId: string }
	| { type: "resumed"; keyId: string }
	| { type: "cancelled"; keyId: string }
	| { type: "completed"; keyId: string; sessionId: number; durationMs: number }
	| { type: "replaced"; keyId: string; durationMs: number; fromKeyId: string; fromState: "running" | "paused" };

export type Output = { renders: KeyRender[]; events: SessionEvent[] };

export const DEFAULT_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 180;
/** A press held at least this long on the session's key cancels and resets instead of tapping. */
export const HOLD_MS = 600;
/** Ring resolution: the arc changes in 1/RING_STEPS increments of the session, which bounds key redraws. */
export const RING_STEPS = 120;
const MINUTE_MS = 60_000;

/**
 * The single shared session. Running stores its absolute end time, never a decrementing counter;
 * paused stores the frozen remaining time. `id` is unique per start and kept through pause, resume
 * and completion.
 */
type Session = { id: number; keyId: string; durationMs: number } & (
	| { status: "running"; endsAt: number }
	| { status: "paused"; remainingMs: number }
	| { status: "completed" }
);

/**
 * A key that is down. `resolved` once a hold has already acted, so its key-up does nothing. `pressed` is
 * the key's own session as the key last showed it when pressed (undefined if it showed idle); a tap
 * does nothing if that has since changed, e.g. the session completed or was replaced before release.
 */
type Press = { keyId: string; downAt: number; resolved: boolean; pressed: SessionMark | undefined };

type SessionMark = { id: number; status: Session["status"] };

/**
 * Application boundary for the timer. Stream Deck events and clock changes go in;
 * per-key render descriptions and session transition events come out. No SDK imports.
 */
export class TimerCoordinator {
	/** Validated preset duration of each visible key, in minutes. */
	readonly #durations = new Map<string, number>();
	/** Validated color and font of each visible key. */
	readonly #styles = new Map<string, KeyStyle>();
	/** The render each visible key last received, so unchanged keys are not redrawn. */
	readonly #shown = new Map<string, KeyRender>();
	readonly #presses = new Map<string, Press>();
	#session: Session | undefined;
	#lastSessionId = 0;
	#events: SessionEvent[] = [];

	constructor(private readonly clock: Clock) {}

	/** A key became visible. An unusable duration falls back to the default. */
	keyAppeared(keyId: string, settings: PresetSettings): Output {
		this.#durations.set(keyId, parseDuration(settings.durationMinutes) ?? DEFAULT_DURATION_MINUTES);
		this.#styles.set(keyId, parseKeyStyle(settings));
		this.#shown.delete(keyId);
		return this.#output();
	}

	/**
	 * A key's settings were edited. An unusable duration keeps the previous one. A session already
	 * running or paused keeps its original duration; the new one applies from the next start. A new color
	 * or font redraws the key at once and never affects the session.
	 */
	settingsChanged(keyId: string, settings: PresetSettings): Output {
		if (!this.#durations.has(keyId)) return this.#output();
		const minutes = parseDuration(settings.durationMinutes);
		if (minutes !== undefined) this.#durations.set(keyId, minutes);
		this.#styles.set(keyId, parseKeyStyle(settings));
		return this.#output();
	}

	keyDisappeared(keyId: string): void {
		this.#durations.delete(keyId);
		this.#styles.delete(keyId);
		this.#shown.delete(keyId);
		this.#presses.delete(keyId);
	}

	/** The key's current preset duration in minutes, as shown when idle. */
	presetMinutes(keyId: string): number {
		return this.#durationMinutes(keyId);
	}

	/** Re-evaluates every visible key against the current clock time, including pending holds. */
	tick(): Output {
		return this.#output();
	}

	/**
	 * Starts a press. What it does is decided on key-up (tap) or when it has been held for HOLD_MS.
	 * The key's session is noted before catching up with the clock, so it matches what the key showed.
	 */
	keyDown(keyId: string): Output {
		this.#presses.set(keyId, { keyId, downAt: this.clock.now(), resolved: false, pressed: this.#markFor(keyId) });
		return this.#output();
	}

	/**
	 * Ends a press. A tap on the session's key pauses or resumes it; a tap on a finished key or any
	 * other key starts a fresh session there, replacing any current one. A tap does nothing if the key's
	 * session changed while it was down (completed, or replaced by another key). A hold already acted,
	 * or acts now if its deadline passed without a tick. A key-up with no key-down is ignored.
	 */
	keyUp(keyId: string): Output {
		this.#advance();
		const press = this.#presses.get(keyId);
		this.#presses.delete(keyId);
		// A hold on the session's key was already applied by #advance; a hold on any other key does nothing.
		if (press === undefined || press.resolved || this.clock.now() - press.downAt >= HOLD_MS) return this.#output();
		if (!sameMark(press.pressed, this.#markFor(keyId))) return this.#output();
		const session = this.#session;
		if (session?.keyId === keyId && session.status === "running") {
			this.#session = { id: session.id, keyId, durationMs: session.durationMs, status: "paused", remainingMs: this.#remainingMs(session) };
			this.#events.push({ type: "paused", keyId });
		} else if (session?.keyId === keyId && session.status === "paused") {
			this.#session = { id: session.id, keyId, durationMs: session.durationMs, status: "running", endsAt: this.clock.now() + session.remainingMs };
			this.#events.push({ type: "resumed", keyId });
		} else {
			this.#start(keyId);
		}
		return this.#output();
	}

	/**
	 * Epoch ms at which something next changes (ring step, minute boundary, completion, or a hold
	 * reaching its threshold); `undefined` when nothing is pending. May be in the past if overdue.
	 */
	nextChangeAt(): number | undefined {
		const candidates: number[] = [];
		for (const press of this.#presses.values()) {
			if (!press.resolved && this.#session?.keyId === press.keyId) candidates.push(press.downAt + HOLD_MS);
		}
		const session = this.#session;
		if (session?.status === "running") {
			const remainingMs = this.#remainingMs(session);
			if (remainingMs <= 0) candidates.push(session.endsAt);
			else {
				const stepMs = session.durationMs / RING_STEPS;
				candidates.push(session.endsAt - (Math.ceil(remainingMs / stepMs) - 1) * stepMs);
				candidates.push(session.endsAt - (Math.ceil(remainingMs / MINUTE_MS) - 1) * MINUTE_MS);
			}
		}
		return candidates.length === 0 ? undefined : Math.min(...candidates);
	}

	#start(keyId: string): void {
		const durationMs = this.#durationMinutes(keyId) * MINUTE_MS;
		const previous = this.#session;
		this.#session = { id: ++this.#lastSessionId, keyId, durationMs, status: "running", endsAt: this.clock.now() + durationMs };
		if (previous !== undefined && previous.status !== "completed") {
			this.#events.push({ type: "replaced", keyId, durationMs, fromKeyId: previous.keyId, fromState: previous.status });
		} else {
			this.#events.push({ type: "started", keyId, durationMs });
		}
	}

	/** A hold on the session's key cancels a running or paused session, or clears a finished one to idle. */
	#cancelOrClear(keyId: string): void {
		const session = this.#session;
		if (session?.keyId !== keyId) return;
		this.#session = undefined;
		if (session.status !== "completed") this.#events.push({ type: "cancelled", keyId });
	}

	/** Applies time-driven transitions: completion, then any hold that has reached its threshold. */
	#advance(): void {
		const now = this.clock.now();
		const session = this.#session;
		if (session?.status === "running" && now >= session.endsAt) {
			this.#session = { id: session.id, keyId: session.keyId, durationMs: session.durationMs, status: "completed" };
			this.#events.push({ type: "completed", keyId: session.keyId, sessionId: session.id, durationMs: session.durationMs });
		}
		for (const press of this.#presses.values()) {
			if (press.resolved || now - press.downAt < HOLD_MS || this.#session?.keyId !== press.keyId) continue;
			press.resolved = true;
			this.#cancelOrClear(press.keyId);
		}
	}

	/**
	 * Time left until the absolute end, clamped to [0, duration]. A wall clock moved backward extends the
	 * session, but the display never shows more than the preset.
	 */
	#remainingMs(session: Session & { status: "running" }): number {
		return Math.min(Math.max(session.endsAt - this.clock.now(), 0), session.durationMs);
	}

	/** Renders every visible key whose appearance differs from what it last showed, plus pending events. */
	#output(): Output {
		this.#advance();
		const renders: KeyRender[] = [];
		for (const keyId of this.#durations.keys()) {
			const render = this.#renderFor(keyId);
			if (!sameRender(this.#shown.get(keyId), render)) {
				this.#shown.set(keyId, render);
				renders.push(render);
			}
		}
		const events = this.#events;
		this.#events = [];
		return { renders, events };
	}

	#markFor(keyId: string): SessionMark | undefined {
		const session = this.#session;
		return session?.keyId === keyId ? { id: session.id, status: session.status } : undefined;
	}

	#durationMinutes(keyId: string): number {
		return this.#durations.get(keyId) ?? DEFAULT_DURATION_MINUTES;
	}

	#renderFor(keyId: string): KeyRender {
		const style = this.#styles.get(keyId) ?? parseKeyStyle({});
		const session = this.#session;
		if (session?.keyId !== keyId) return { keyId, state: "idle", minutes: this.#durationMinutes(keyId), style };
		if (session.status === "completed") return { keyId, state: "done", minutes: 0, style };
		const remainingMs = session.status === "running" ? this.#remainingMs(session) : session.remainingMs;
		return {
			keyId,
			state: session.status,
			minutes: Math.ceil(remainingMs / MINUTE_MS),
			ring: ringFraction(remainingMs, session.durationMs),
			style,
		};
	}
}

/** Whole minutes from 1 to MAX_DURATION_MINUTES, given as a number or a numeric string; otherwise undefined. */
export function parseDuration(value: unknown): number | undefined {
	const n = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
	return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_DURATION_MINUTES ? n : undefined;
}

/** Remaining fraction rounded up to the next ring step, so the ring is full at start and empty only at completion. */
function ringFraction(remainingMs: number, durationMs: number): number {
	return Math.ceil((remainingMs / durationMs) * RING_STEPS) / RING_STEPS;
}

function sameMark(a: SessionMark | undefined, b: SessionMark | undefined): boolean {
	return a?.id === b?.id && a?.status === b?.status;
}

function sameRender(a: KeyRender | undefined, b: KeyRender): boolean {
	return (
		a !== undefined &&
		a.state === b.state &&
		a.minutes === b.minutes &&
		ringOf(a) === ringOf(b) &&
		a.style.color === b.style.color &&
		a.style.font === b.style.font
	);
}

function ringOf(render: KeyRender): number | undefined {
	return render.state === "running" || render.state === "paused" ? render.ring : undefined;
}
