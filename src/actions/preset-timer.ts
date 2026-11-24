import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type PropertyInspectorDidAppearEvent,
	type PropertyInspectorDidDisappearEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { AlertDispatcher } from "../alerts/dispatcher";
import { AfplaySoundPlayer, OsascriptNotifier } from "../alerts/macos";
import { systemClock } from "../core/clock";
import { parseDuration, type PresetSettings } from "../core/coordinator";
import { FocusDispatcher } from "../focus/dispatcher";
import { answerShortcutPicker } from "../focus/picker";
import { ShortcutsCli } from "../focus/shortcuts";
import { FocusStatus } from "../focus/status";
import type { StateStore } from "../persistence/store";
import { keyImageDataUrl } from "../render/key-image";
import { PresetController } from "./preset-controller";

export const PRESET_ACTION_UUID = "com.austinzani.neo-pomodoro.preset";

/**
 * Thin Stream Deck adapter: forwards key and settings events to the PresetController and paints its
 * renders with setImage. Each key's duration, color and font are action settings the SDK persists; the
 * completion alert and Focus preferences are plugin global settings shared by every key, read when used.
 * A failed Focus shortcut shows the key's alert and is reported in the Property Inspector's Focus section
 * until a shortcut runs or the Focus settings change. The timer session and alert delivery record are
 * saved in the plugin's state file (`store`), loaded before this action is created.
 */
@action({ UUID: PRESET_ACTION_UUID })
export class PresetTimerAction extends SingletonAction<PresetSettings> {
	readonly #keys = new Map<string, KeyAction<PresetSettings>>();
	readonly #shortcuts = new ShortcutsCli();
	/** The latest Focus problem, shown in the open Property Inspector. */
	readonly #focusStatus = new FocusStatus((status) => this.#sendToInspector(status));
	readonly #controller: PresetController;

	constructor(store: StateStore) {
		super();
		this.#controller = new PresetController({
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
				// None when this run can't save (logged once at startup), so alerts don't each report a failed save.
				delivery: store.alertDelivery(),
			}),
			focus: new FocusDispatcher({
				loadSettings: () => streamDeck.settings.getGlobalSettings(),
				shortcuts: this.#shortcuts,
				reportFailure: (keyId, message) => {
					this.#keys.get(keyId)?.showAlert().catch((err: unknown) => streamDeck.logger.error("showAlert failed", err));
					this.#focusStatus.failed(`${new Date().toLocaleTimeString()}: ${message}`);
				},
				reportSuccess: () => this.#focusStatus.succeeded(),
				log: streamDeck.logger,
				record: store.focusRecord(),
			}),
			log: streamDeck.logger,
			store,
		});
		// Timers can fire late after sleep; redraw from the absolute end time as soon as the Mac wakes.
		streamDeck.system.onSystemDidWakeUp(() => this.#controller.wake());
		// Reconnecting the Neo redraws its keys from the current state; while it is unplugged the timer keeps going.
		streamDeck.devices.onDeviceDidConnect(() => this.#controller.deviceConnected());
		streamDeck.devices.onDeviceDidDisconnect(() => this.#controller.deviceDisconnected());
		// Fired only when the Property Inspector changes the shared settings (not on getGlobalSettings).
		streamDeck.settings.onDidReceiveGlobalSettings((ev) => this.#focusStatus.settingsChanged(ev.settings));
	}

	/** Catches up once connected to Stream Deck: completes and alerts a session that ended while the plugin was stopped. */
	recover(): void {
		this.#controller.recover();
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

	override onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent<PresetSettings>): void {
		this.#sendToInspector(this.#focusStatus.current);
		// Settings can only change while an inspector is open; remember them to spot a Focus change.
		streamDeck.settings
			.getGlobalSettings()
			.then((settings) => this.#focusStatus.settingsSeen(settings))
			.catch((err: unknown) => streamDeck.logger.error("getGlobalSettings failed", err));
	}

	/** Answers the inspector's request for the Focus problem line, and the Focus shortcut pickers' requests for the user's shortcuts. */
	override async onSendToPlugin(ev: SendToPluginEvent<{ event: string }, PresetSettings>): Promise<void> {
		const reply =
			this.#focusStatus.answer(ev.payload) ??
			(await answerShortcutPicker(ev.payload, {
				list: () => this.#shortcuts.list(),
				loadSettings: () => streamDeck.settings.getGlobalSettings(),
				log: streamDeck.logger,
			}));
		if (reply !== undefined) this.#sendToInspector(reply);
	}

	override onKeyDown(ev: KeyDownEvent<PresetSettings>): void {
		this.#controller.keyDown(ev.action.id);
	}

	override onKeyUp(ev: KeyUpEvent<PresetSettings>): void {
		this.#controller.keyUp(ev.action.id);
	}

	/** Sends a message to the open Property Inspector, if any. */
	#sendToInspector(message: Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0]): void {
		if (streamDeck.ui.action === undefined) return;
		streamDeck.ui.sendToPropertyInspector(message).catch((err: unknown) => streamDeck.logger.error("sendToPropertyInspector failed", err));
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
