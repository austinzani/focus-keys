import type { Clock } from "../core/clock";
import { type KeyRender, type Output, type PresetSettings, type SessionEvent, TimerCoordinator } from "../core/coordinator";
import type { Log } from "../alerts/dispatcher";
import { WakeTimer } from "./wake-timer";

/** What the controller needs from the outside world; tests pass fakes. */
export type PresetControllerPorts = {
	clock: Clock;
	/** Draws a render on its key, if that key is visible. */
	paint(render: KeyRender): void;
	/** Acts on session transitions (completion alerts). A failure is logged and never reaches the timer. */
	alerts: { handle(events: readonly SessionEvent[]): Promise<void> };
	log: Log;
};

/**
 * The plugin's runtime wiring, free of the Stream Deck SDK so it can be tested: key events go to the
 * coordinator, its renders are painted, its session events go to the alert dispatcher, and one wake timer
 * fires when the coordinator says something next changes. The wake stays scheduled even with no visible
 * keys, so a completion is processed (and alerted) on time.
 */
export class PresetController {
	readonly #coordinator: TimerCoordinator;
	readonly #wake: WakeTimer;

	constructor(private readonly ports: PresetControllerPorts) {
		this.#coordinator = new TimerCoordinator(ports.clock);
		this.#wake = new WakeTimer(ports.clock, () => this.wake());
	}

	keyAppeared(keyId: string, settings: PresetSettings): void {
		this.#apply(this.#coordinator.keyAppeared(keyId, settings));
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

	presetMinutes(keyId: string): number {
		return this.#coordinator.presetMinutes(keyId);
	}

	#apply(out: Output): void {
		for (const render of out.renders) this.ports.paint(render);
		for (const event of out.events) this.ports.log.info(`session ${JSON.stringify(event)}`);
		if (out.events.length > 0) {
			this.ports.alerts.handle(out.events).catch((err: unknown) => this.ports.log.error("Alert failed", err));
		}
		this.#wake.schedule(this.#coordinator.nextChangeAt());
	}
}
