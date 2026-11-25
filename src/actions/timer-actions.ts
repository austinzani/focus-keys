import { fileURLToPath } from "node:url";

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
import { AfplaySoundPlayer, FallbackNotifier, HelperNotifier, OsascriptNotifier } from "../alerts/macos";
import { systemClock } from "../core/clock";
import { defaultColorFor, parseDuration, type PresetSettings, type TimerKind } from "../core/coordinator";
import { legacySweepBackground, parseKeyStyle } from "../core/key-style";
import { FocusDispatcher } from "../focus/dispatcher";
import { answerShortcutPicker } from "../focus/picker";
import { ShortcutsCli } from "../focus/shortcuts";
import { FocusStatus } from "../focus/status";
import type { StateStore } from "../persistence/store";
import { keyImageDataUrl } from "../render/key-image";
import { PresetController } from "./preset-controller";

export const PRESET_ACTION_UUID = "com.austinzani.focus-keys.preset";
export const BREAK_ACTION_UUID = "com.austinzani.focus-keys.break";

/** The bundled notification helper (built by `npm run notifier`), next to bin/plugin.js in the plugin folder. */
const NOTIFIER_APP = fileURLToPath(new URL("../notifier/Focus Keys.app", import.meta.url));

type TimerKey = KeyAction<PresetSettings>;
type SettingsTarget = { id: string; setSettings(s: PresetSettings): Promise<void> };

/**
 * What both timer actions share: the one PresetController (so one session runs across Timer Preset and
 * Break keys), the visible keys it paints with setImage, and the Focus problem line shown in the open
 * Property Inspector. Each key's duration, color and font are action settings the SDK persists; the
 * completion alert and Focus preferences are plugin global settings shared by every key, read when used.
 * A failed Focus shortcut shows the key's alert and is reported in the Property Inspector's Focus section
 * until a shortcut runs or the Focus settings change. The timer session and alert delivery record are
 * saved in the plugin's state file (`store`), loaded before the actions are created.
 */
export class TimerKeys {
	readonly #keys = new Map<string, TimerKey>();
	readonly #shortcuts = new ShortcutsCli();
	/** The latest Focus problem, shown in the open Property Inspector. */
	readonly #focusStatus = new FocusStatus((status) => this.#sendToInspector(status));
	readonly #controller: PresetController;

	constructor(store: StateStore) {
		this.#controller = new PresetController({
			clock: systemClock,
			paint: (render) => {
				const key = this.#keys.get(render.keyId);
				key?.setImage(keyImageDataUrl(render)).catch((err: unknown) => streamDeck.logger.error("setImage failed", err));
			},
			alerts: new AlertDispatcher({
				loadSettings: () => streamDeck.settings.getGlobalSettings(),
				sound: new AfplaySoundPlayer(),
				notifier: new FallbackNotifier(new HelperNotifier(NOTIFIER_APP), new OsascriptNotifier(), streamDeck.logger),
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

	appeared(key: TimerKey, settings: PresetSettings, kind: TimerKind): void {
		this.#keys.set(key.id, key);
		this.#controller.keyAppeared(key.id, settings, kind);
		this.#saveEffectiveSettings(key, settings, kind);
	}

	disappeared(keyId: string): void {
		this.#keys.delete(keyId);
		this.#controller.keyDisappeared(keyId);
	}

	settingsChanged(keyId: string, settings: PresetSettings, kind: TimerKind): void {
		this.#controller.settingsChanged(keyId, settings);
		const key = this.#keys.get(keyId);
		if (key && legacySweepBackground(settings) !== undefined) this.#saveEffectiveSettings(key, settings, kind);
	}

	/** The Property Inspector saves each committed entry (Enter, blur, close); once it closes, an unusable entry is replaced. */
	inspectorClosed(key: TimerKey, kind: TimerKind): void {
		key
			.getSettings()
			.then((settings) => this.#saveEffectiveSettings(key, settings, kind))
			.catch((err: unknown) => streamDeck.logger.error("getSettings failed", err));
	}

	inspectorOpened(): void {
		this.#sendToInspector(this.#focusStatus.current);
		// Settings can only change while an inspector is open; remember them to spot a Focus change.
		streamDeck.settings
			.getGlobalSettings()
			.then((settings) => this.#focusStatus.settingsSeen(settings))
			.catch((err: unknown) => streamDeck.logger.error("getGlobalSettings failed", err));
	}

	/** Answers the inspector's request for the Focus problem line, and the Focus shortcut pickers' requests for the user's shortcuts. */
	async messageFromInspector(payload: { event: string }): Promise<void> {
		const reply =
			this.#focusStatus.answer(payload) ??
			(await answerShortcutPicker(payload, {
				list: () => this.#shortcuts.list(),
				loadSettings: () => streamDeck.settings.getGlobalSettings(),
				log: streamDeck.logger,
			}));
		if (reply !== undefined) this.#sendToInspector(reply);
	}

	keyDown(keyId: string): void {
		this.#controller.keyDown(keyId);
	}

	keyUp(keyId: string): void {
		this.#controller.keyUp(keyId);
	}

	/** Sends a message to the open Property Inspector, if any. */
	#sendToInspector(message: Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0]): void {
		if (streamDeck.ui.action === undefined) return;
		streamDeck.ui.sendToPropertyInspector(message).catch((err: unknown) => streamDeck.logger.error("sendToPropertyInspector failed", err));
	}

	/**
	 * Writes what the key actually uses back to its settings when the stored value is missing or unusable,
	 * so a new key's fields show it and a bad duration entry doesn't turn into 5 after a restart. A Break key
	 * also gets its teal default color written, because the shared Property Inspector's color default is the
	 * preset's; preset keys are left alone, so DEFAULT_COLOR still reaches keys that never chose one.
	 */
	#saveEffectiveSettings(key: SettingsTarget, settings: PresetSettings, kind: TimerKind): void {
		const fill: PresetSettings = {};
		if (parseDuration(settings.durationMinutes) === undefined) fill.durationMinutes = String(this.#controller.presetMinutes(key.id));
		if (kind === "break" && typeof settings.color !== "string") fill.color = defaultColorFor(kind);
		const style = parseKeyStyle(settings, defaultColorFor(kind));
		if (settings.ringColor === undefined) fill.ringColor = style.ringColor;
		if (settings.sweepEnd === undefined) fill.sweepEnd = style.sweepEnd;
		const migratedBackground = legacySweepBackground(settings);
		if (migratedBackground !== undefined) fill.backgroundColor = migratedBackground;
		if (Object.keys(fill).length === 0) return;
		key.setSettings({ ...settings, ...fill }).catch((err: unknown) => streamDeck.logger.error("setSettings failed", err));
	}
}

/** Forwards one action's key and settings events to the shared TimerKeys, tagged with the action's kind. */
class TimerAction extends SingletonAction<PresetSettings> {
	readonly #timer: TimerKeys;
	readonly #kind: TimerKind;

	constructor(timer: TimerKeys, kind: TimerKind) {
		super();
		this.#timer = timer;
		this.#kind = kind;
	}

	override onWillAppear(ev: WillAppearEvent<PresetSettings>): void {
		if (ev.action.isKey()) this.#timer.appeared(ev.action, ev.payload.settings, this.#kind);
	}

	override onWillDisappear(ev: WillDisappearEvent<PresetSettings>): void {
		this.#timer.disappeared(ev.action.id);
	}

	/** Fired when the Property Inspector saves this key's settings. */
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PresetSettings>): void {
		this.#timer.settingsChanged(ev.action.id, ev.payload.settings, this.#kind);
	}

	override onPropertyInspectorDidDisappear(ev: PropertyInspectorDidDisappearEvent<PresetSettings>): void {
		if (ev.action.isKey()) this.#timer.inspectorClosed(ev.action, this.#kind);
	}

	override onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent<PresetSettings>): void {
		this.#timer.inspectorOpened();
	}

	override onSendToPlugin(ev: SendToPluginEvent<{ event: string }, PresetSettings>): Promise<void> {
		return this.#timer.messageFromInspector(ev.payload);
	}

	override onKeyDown(ev: KeyDownEvent<PresetSettings>): void {
		this.#timer.keyDown(ev.action.id);
	}

	override onKeyUp(ev: KeyUpEvent<PresetSettings>): void {
		this.#timer.keyUp(ev.action.id);
	}
}

/** A focus timer key: switches Focus when that is turned on. */
@action({ UUID: PRESET_ACTION_UUID })
export class PresetTimerAction extends TimerAction {
	constructor(timer: TimerKeys) {
		super(timer, "focus");
	}
}

/** A break timer key: shares the one timer with the preset keys but never turns Focus on. */
@action({ UUID: BREAK_ACTION_UUID })
export class BreakTimerAction extends TimerAction {
	constructor(timer: TimerKeys) {
		super(timer, "break");
	}
}
