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

import { AlertDispatcher } from "../alerts/dispatcher";
import { AfplaySoundPlayer, OsascriptNotifier } from "../alerts/macos";
import { systemClock } from "../core/clock";
import { parseDuration, type PresetSettings } from "../core/coordinator";
import { keyImageDataUrl } from "../render/key-image";
import { PresetController } from "./preset-controller";

export const PRESET_ACTION_UUID = "com.austinzani.neo-pomodoro.preset";

/**
 * Thin Stream Deck adapter: forwards key and settings events to the PresetController and paints its
 * renders with setImage. Each key's duration, color and font are action settings the SDK persists; the
 * completion alert preferences are plugin global settings shared by every key, read when a session completes.
 */
@action({ UUID: PRESET_ACTION_UUID })
export class PresetTimerAction extends SingletonAction<PresetSettings> {
	readonly #keys = new Map<string, KeyAction<PresetSettings>>();
	readonly #controller = new PresetController({
		clock: systemClock,
		paint: (render) => {
			const key = this.#keys.get(render.keyId);
			key?.setImage(keyImageDataUrl(render)).catch((err: unknown) => streamDeck.logger.error("setImage failed", err));
		},
		alerts: new AlertDispatcher({
			loadSettings: () => streamDeck.settings.getGlobalSettings(),
			sound: new AfplaySoundPlayer(),
			notifier: new OsascriptNotifier(),
			log: streamDeck.logger,
		}),
		log: streamDeck.logger,
	});

	constructor() {
		super();
		// Timers can fire late after sleep; redraw from the absolute end time as soon as the Mac wakes.
		streamDeck.system.onSystemDidWakeUp(() => this.#controller.wake());
	}

	override onWillAppear(ev: WillAppearEvent<PresetSettings>): void {
		if (!ev.action.isKey()) return;
		this.#keys.set(ev.action.id, ev.action);
		this.#controller.keyAppeared(ev.action.id, ev.payload.settings);
		this.#saveEffectiveDuration(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<PresetSettings>): void {
		this.#keys.delete(ev.action.id);
		this.#controller.keyDisappeared(ev.action.id);
	}

	/** Fired when the Property Inspector saves this key's settings. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PresetSettings>): void {
		this.#controller.settingsChanged(ev.action.id, ev.payload.settings);
	}

	/** The Property Inspector saves each committed entry (Enter, blur, close); once it closes, an unusable entry is replaced. */
	override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<PresetSettings>): void {
		ev.action
			.getSettings()
			.then((settings) => this.#saveEffectiveDuration(ev.action, settings))
			.catch((err: unknown) => streamDeck.logger.error("getSettings failed", err));
	}

	override onKeyDown(ev: KeyDownEvent<PresetSettings>): void {
		this.#controller.keyDown(ev.action.id);
	}

	override onKeyUp(ev: KeyUpEvent<PresetSettings>): void {
		this.#controller.keyUp(ev.action.id);
	}

	/**
	 * Writes the duration the key actually uses back to its settings when the stored value is missing or
	 * unusable, so a new key's field shows 5 and a bad entry doesn't turn into 5 after a restart.
	 */
	#saveEffectiveDuration(action: { id: string; setSettings(s: PresetSettings): Promise<void> }, settings: PresetSettings): void {
		if (parseDuration(settings.durationMinutes) !== undefined) return;
		const durationMinutes = String(this.#controller.presetMinutes(action.id));
		action.setSettings({ ...settings, durationMinutes }).catch((err: unknown) => streamDeck.logger.error("setSettings failed", err));
	}
}
