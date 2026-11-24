import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type PropertyInspectorDidDisappearEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { systemClock } from "../core/clock";
import { type Output, parseDuration, type PresetSettings, TimerCoordinator } from "../core/coordinator";
import { keyImageDataUrl } from "../render/key-image";
import { WakeTimer } from "./wake-timer";

export const PRESET_ACTION_UUID = "com.austinzani.neo-pomodoro.preset";

/**
 * Thin Stream Deck adapter: forwards key and settings events to the coordinator, paints its renders with
 * setImage, and wakes at the moment the coordinator says something next changes (a countdown step or a
 * hold reaching its threshold). Each key's duration is an action setting the SDK persists across restarts.
 */
@action({ UUID: PRESET_ACTION_UUID })
export class PresetTimerAction extends SingletonAction<PresetSettings> {
	readonly #coordinator = new TimerCoordinator(systemClock);
	readonly #keys = new Map<string, KeyAction<PresetSettings>>();
	// The wake stays scheduled even with no visible keys, so completion is still processed on time.
	readonly #wake = new WakeTimer(systemClock, () => this.#apply(this.#coordinator.tick()));

	constructor() {
		super();
		// Timers can fire late after sleep; redraw from the absolute end time as soon as the Mac wakes.
		streamDeck.system.onSystemDidWakeUp(() => this.#apply(this.#coordinator.tick()));
	}

	override onWillAppear(ev: WillAppearEvent<PresetSettings>): void {
		if (!ev.action.isKey()) return;
		this.#keys.set(ev.action.id, ev.action);
		this.#apply(this.#coordinator.keyAppeared(ev.action.id, ev.payload.settings));
		this.#saveEffectiveDuration(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<PresetSettings>): void {
		this.#keys.delete(ev.action.id);
		this.#coordinator.keyDisappeared(ev.action.id);
	}

	/** Fired when the Property Inspector saves this key's settings. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PresetSettings>): void {
		this.#apply(this.#coordinator.settingsChanged(ev.action.id, ev.payload.settings));
	}

	/** The Property Inspector saves each committed entry (Enter, blur, close); once it closes, an unusable entry is replaced. */
	override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<PresetSettings>): void {
		ev.action
			.getSettings()
			.then((settings) => this.#saveEffectiveDuration(ev.action, settings))
			.catch((err: unknown) => streamDeck.logger.error("getSettings failed", err));
	}

	override onKeyDown(ev: KeyDownEvent<PresetSettings>): void {
		this.#apply(this.#coordinator.keyDown(ev.action.id));
	}

	override onKeyUp(ev: KeyUpEvent<PresetSettings>): void {
		this.#apply(this.#coordinator.keyUp(ev.action.id));
	}

	/**
	 * Writes the duration the key actually uses back to its settings when the stored value is missing or
	 * unusable, so a new key's field shows 5 and a bad entry doesn't turn into 5 after a restart.
	 */
	#saveEffectiveDuration(action: { id: string; setSettings(s: PresetSettings): Promise<void> }, settings: PresetSettings): void {
		if (parseDuration(settings.durationMinutes) !== undefined) return;
		const durationMinutes = String(this.#coordinator.presetMinutes(action.id));
		action.setSettings({ ...settings, durationMinutes }).catch((err: unknown) => streamDeck.logger.error("setSettings failed", err));
	}

	#apply(out: Output): void {
		for (const render of out.renders) {
			const key = this.#keys.get(render.keyId);
			if (key === undefined) continue;
			key.setImage(keyImageDataUrl(render)).catch((err: unknown) => streamDeck.logger.error("setImage failed", err));
		}
		// Alert and Focus integrations (AUS-1882, AUS-1883) will act on these transitions.
		for (const event of out.events) streamDeck.logger.info("session", JSON.stringify(event));
		this.#wake.schedule(this.#coordinator.nextChangeAt());
	}
}
