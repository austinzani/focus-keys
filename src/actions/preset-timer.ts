import streamDeck, {
	action,
	type KeyAction,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { systemClock } from "../core/clock";
import { type Output, type PresetSettings, TimerCoordinator } from "../core/coordinator";
import { keyImageDataUrl } from "../render/key-image";

export const PRESET_ACTION_UUID = "com.austinzani.neo-pomodoro.preset";

/** Small margin so a wake-up lands just after the scheduled boundary, never just before it. */
const WAKE_MARGIN_MS = 5;

/**
 * Thin Stream Deck adapter: forwards key events to the coordinator, paints its renders with setImage,
 * and schedules the next wake-up at the moment the coordinator says a key will next change.
 */
@action({ UUID: PRESET_ACTION_UUID })
export class PresetTimerAction extends SingletonAction<PresetSettings> {
	readonly #coordinator = new TimerCoordinator(systemClock);
	readonly #keys = new Map<string, KeyAction<PresetSettings>>();
	#wakeTimer: NodeJS.Timeout | undefined;

	constructor() {
		super();
		// Timers can fire late after sleep; redraw from the absolute end time as soon as the Mac wakes.
		streamDeck.system.onSystemDidWakeUp(() => this.#apply(this.#coordinator.tick()));
	}

	override onWillAppear(ev: WillAppearEvent<PresetSettings>): void {
		if (!ev.action.isKey()) return;
		this.#keys.set(ev.action.id, ev.action);
		this.#apply(this.#coordinator.keyAppeared(ev.action.id, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<PresetSettings>): void {
		this.#keys.delete(ev.action.id);
		// The wake stays scheduled even with no visible keys, so completion is still processed on time.
		this.#coordinator.keyDisappeared(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<PresetSettings>): void {
		this.#apply(this.#coordinator.keyPressed(ev.action.id));
	}

	#apply(out: Output): void {
		for (const render of out.renders) {
			const key = this.#keys.get(render.keyId);
			if (key === undefined) continue;
			key.setImage(keyImageDataUrl(render)).catch((err: unknown) => streamDeck.logger.error("setImage failed", err));
		}
		this.#scheduleWake();
	}

	/** Replaces any pending wake with one at the coordinator's next change, while a session runs. */
	#scheduleWake(): void {
		clearTimeout(this.#wakeTimer);
		this.#wakeTimer = undefined;
		const at = this.#coordinator.nextChangeAt();
		if (at === undefined) return;
		const delay = Math.max(0, at - systemClock.now()) + WAKE_MARGIN_MS;
		this.#wakeTimer = setTimeout(() => this.#apply(this.#coordinator.tick()), delay);
	}
}
