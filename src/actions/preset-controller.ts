import type { Clock } from "../core/clock";
import { type KeyRender, kindOf, type Output, type PresetSettings, type SessionEvent, type TimerKind, TimerCoordinator } from "../core/coordinator";
import type { Log } from "../alerts/dispatcher";
import type { PersistedState } from "../persistence/store";
import { WakeTimer } from "./wake-timer";

/** What the controller needs from the outside world; tests pass fakes. */
export type PresetControllerPorts = {
	clock: Clock;
	/** Draws a render on its key, if that key is visible. */
	paint(render: KeyRender): void;
	/** Acts on session transitions (completion alerts). A failure is logged and never reaches the timer. */
	alerts: { handle(events: readonly SessionEvent[]): Promise<void> };
	/**
	 * Runs the Focus shortcuts for session transitions, in order. Never awaited: Focus never holds up the
	 * timer. `endLeftover` ends, after a restart, Focus the plugin turned on for work that is no longer running.
	 */
	focus: { handle(events: readonly SessionEvent[]): Promise<void>; endLeftover?(keyId: string): Promise<void> };
	log: Log;
	/**
	 * The saved state (persistence/store.ts StateStore): the timer starts from it, and every session
	 * transition is written back. Saving never rejects or holds up the timer. Optional so tests can skip it.
	 */
	store?: { readonly state: PersistedState; update(change: Partial<PersistedState>): Promise<boolean> };
};

/**
 * The plugin's runtime wiring, free of the Stream Deck SDK so it can be tested: key events go to the
 * coordinator, its renders are painted, its session events go to the alert and Focus dispatchers, and one wake timer
 * fires when the coordinator says something next changes. The wake stays scheduled even with no visible
 * keys, so a completion is processed (and alerted) on time.
 *
 * Recovery: the session is restored from the saved state at construction and every transition is saved,
 * so a restart or sleep picks up from the original end time. `recover()` runs once Stream Deck is
 * connected: a session that ended while the plugin was stopped completes then, and its alert is delivered
 * once (the alert dispatcher dedupes by saved session id). Focus the plugin turned on for work that is no
 * longer running is ended once (the Focus dispatcher dedupes by its saved record), as is Focus left on while a break runs. Keys appearing later
 * draw the restored state.
 */
export class PresetController {
	readonly #coordinator: TimerCoordinator;
	readonly #wake: WakeTimer;
	/** The coordinator snapshot last handed to the store, so only changes are saved. */
	#saved: string;
	/** The state as loaded at startup, before any key could change it: what `recover()` reports and catches up on. */
	readonly #loaded: PersistedState | undefined;

	constructor(private readonly ports: PresetControllerPorts) {
		const saved = ports.store?.state;
		this.#loaded = saved;
		// Seed ids past every saved one, so a damaged counter can't reuse ids the alert or Focus record already covers.
		const restored = saved && {
			lastSessionId: Math.max(saved.lastSessionId, saved.lastAlertedSessionId, saved.focusSessionId),
			session: saved.session,
		};
		this.#coordinator = new TimerCoordinator(ports.clock, restored);
		this.#saved = JSON.stringify(this.#coordinator.snapshot());
		this.#wake = new WakeTimer(ports.clock, () => this.wake());
	}

	/**
	 * Catches up after a (re)start: logs what was restored, delivers the alert of a completion saved just
	 * before a crash that came before its alert, completes a session that ended meanwhile, ends Focus left
	 * on for work that is no longer running, and schedules the next wake. Safe to call more than once.
	 */
	recover(): void {
		const saved = this.#loaded;
		const session = saved?.session;
		// A key that appeared before this may already have caught up; the alert dispatcher dedupes what follows.
		this.ports.log.info(session === undefined ? "no persisted session" : `restored session ${JSON.stringify(session)}`);
		if (session?.status === "completed" && session.id > (saved?.lastAlertedSessionId ?? 0)) {
			const missed = { type: "completed", keyId: session.keyId, sessionId: session.id, durationMs: session.durationMs, ...kindOf(session) } as const;
			this.ports.alerts.handle([missed]).catch((err: unknown) => this.ports.log.error("Alert failed", err));
		}
		this.wake();
		const now = this.#coordinator.snapshot().session;
		// A running break doesn't want Focus either (a crash can leave Focus on just after switching to one).
		if (now?.status !== "running" || now.kind === "break") {
			this.ports.focus.endLeftover?.(now?.keyId ?? "").catch((err: unknown) => this.ports.log.error("Focus switching failed", err));
		}
	}

	/** Cancels the pending wake-up, as when the plugin quits (the process exit does this in production; tests call it to model a quit). */
	stop(): void {
		this.#wake.schedule(undefined);
	}

	keyAppeared(keyId: string, settings: PresetSettings, kind: TimerKind = "focus"): void {
		this.#apply(this.#coordinator.keyAppeared(keyId, settings, kind));
	}

	keyDisappeared(keyId: string): void {
		this.#coordinator.keyDisappeared(keyId);
	}

	settingsChanged(keyId: string, settings: PresetSettings): void {
		this.#apply(this.#coordinator.settingsChanged(keyId, settings));
	}

	keyDown(keyId: string): void {
		this.#apply(this.#coordinator.keyDown(keyId));
	}

	keyUp(keyId: string): void {
		this.#apply(this.#coordinator.keyUp(keyId));
	}

	/** Re-evaluates against the clock: on the wake timer, and when the Mac wakes from sleep. */
	wake(): void {
		this.#apply(this.#coordinator.tick());
	}

	/**
	 * A Stream Deck was plugged back in: catches up with the clock and redraws every visible key, since
	 * the device may have missed renders while away. Keys it brings back through appear events redraw anyway.
	 */
	deviceConnected(): void {
		this.#apply(this.#coordinator.redrawAll());
	}

	/** A Stream Deck was unplugged. The wake timer keeps running, so the session completes and alerts on time. */
	deviceDisconnected(): void {
		this.ports.log.info("Stream Deck disconnected; the timer keeps running");
	}

	presetMinutes(keyId: string): number {
		return this.#coordinator.presetMinutes(keyId);
	}

	#apply(out: Output): void {
		for (const render of out.renders) this.ports.paint(render);
		for (const event of out.events) this.ports.log.info(`session ${JSON.stringify(event)}`);
		// Save before alerting, on any change: transitions, and clearing a finished key (which reports no event).
		const snapshot = this.#coordinator.snapshot();
		const json = JSON.stringify(snapshot);
		if (json !== this.#saved) {
			this.#saved = json;
			void this.ports.store?.update(snapshot);
		}
		if (out.events.length > 0) {
			this.ports.alerts.handle(out.events).catch((err: unknown) => this.ports.log.error("Alert failed", err));
			this.ports.focus.handle(out.events).catch((err: unknown) => this.ports.log.error("Focus switching failed", err));
		}
		this.#wake.schedule(this.#coordinator.nextChangeAt());
	}
}
