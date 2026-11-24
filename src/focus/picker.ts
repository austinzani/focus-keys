import { type Log, withTimeout } from "../alerts/dispatcher";
import { type FocusSettings, parseFocusPrefs, type ShortcutChoice, shortcutChoices } from "../core/focus";

/** sdpi-select `datasource` names in the Property Inspector, and which shortcut each picks. */
export const SHORTCUT_PICKERS = { focusStartShortcuts: "start", focusEndShortcuts: "end" } as const;
type PickerEvent = keyof typeof SHORTCUT_PICKERS;

export type PickerPorts = {
	list(): Promise<string[]>;
	loadSettings(): Promise<FocusSettings | undefined>;
	log: Log;
};

/**
 * Answers a Property Inspector shortcut picker's request (`{ event, isRefresh? }`, sent to the plugin) with
 * the options to show (`{ event, items }`, sent back to the inspector). Undefined for any other message.
 */
export async function answerShortcutPicker(message: unknown, ports: PickerPorts): Promise<{ event: PickerEvent; items: ShortcutChoice[] } | undefined> {
	const event = typeof message === "object" && message !== null ? (message as { event?: unknown }).event : undefined;
	if (!isPickerEvent(event)) return undefined;
	const kind = SHORTCUT_PICKERS[event];
	let names: string[] | undefined;
	try {
		names = await ports.list();
	} catch (err) {
		ports.log.error("Could not list shortcuts", err);
	}
	let settings: FocusSettings | undefined;
	try {
		settings = await withTimeout(ports.loadSettings(), SETTINGS_TIMEOUT_MS);
	} catch (err) {
		ports.log.error("Could not read Focus settings", err);
	}
	const prefs = parseFocusPrefs(settings);
	const items = shortcutChoices(kind, names, kind === "start" ? prefs.startShortcut : prefs.endShortcut);
	return { event, items };
}

/** How long to wait for the shared settings before answering without the current choice. */
const SETTINGS_TIMEOUT_MS = 2_000;

function isPickerEvent(value: unknown): value is PickerEvent {
	return typeof value === "string" && Object.hasOwn(SHORTCUT_PICKERS, value);
}
