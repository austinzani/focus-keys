/**
 * Optional Focus switching, shared by every timer key (plugin global settings). The plugin never reads or
 * sets Focus itself: it runs Shortcuts the user made with the Shortcuts app's "Set Focus" action. No SDK or
 * OS imports; the dispatcher and adapters run the shortcuts.
 */
import type { SessionEvent } from "./coordinator";

/** Global settings as the Property Inspector saves them. Anything may be missing or malformed. */
export type FocusSettings = { focusEnabled?: unknown; focusStartShortcut?: unknown; focusEndShortcut?: unknown };

/**
 * Validated Focus settings. An empty shortcut name means "run nothing": no start shortcut leaves Focus alone
 * on start/resume; no end shortcut leaves Focus as it is on pause/cancel/completion (the explicit fallback).
 */
export type FocusPrefs = { enabled: boolean; startShortcut: string; endShortcut: string };

/** Longer names are treated as unusable; the Shortcuts app's own names are far shorter. */
export const MAX_SHORTCUT_NAME = 200;

/** Only `true` enables; a name is used trimmed, and one that is blank, too long or holds control characters counts as none. */
export function parseFocusPrefs(settings: FocusSettings | undefined): FocusPrefs {
	return {
		enabled: settings?.focusEnabled === true,
		startShortcut: shortcutName(settings?.focusStartShortcut),
		endShortcut: shortcutName(settings?.focusEndShortcut),
	};
}

/**
 * What a session transition means for Focus, at the level of the whole focus session rather than a key:
 * running work wants the start Focus; a pause, cancel or completion ends it. A replacement wants running
 * work too; the dispatcher does nothing for it when the focus session is already started (replacing running work).
 */
export function focusIntent(event: SessionEvent): "start" | "end" {
	switch (event.type) {
		case "started":
		case "resumed":
		case "replaced":
			return "start";
		case "paused":
		case "cancelled":
		case "completed":
			return "end";
	}
}

function shortcutName(value: unknown): string {
	if (typeof value !== "string") return "";
	const name = value.trim();
	return name.length > MAX_SHORTCUT_NAME || /[\u0000-\u001f\u007f]/.test(name) ? "" : name;
}

/** One option of a shortcut picker in the Property Inspector (an sdpi-select data source item). */
export type ShortcutChoice = { value: string; label: string };

/**
 * Options for the start or end shortcut picker: "run nothing" first, then the user's shortcuts. A chosen
 * shortcut that isn't listed stays selectable, marked "(not found)" when the list was read, so a renamed or
 * deleted shortcut is visible rather than silently blank. `names` is undefined if the list couldn't be read.
 */
export function shortcutChoices(kind: "start" | "end", names: readonly string[] | undefined, current: string): ShortcutChoice[] {
	const choices: ShortcutChoice[] = [{ value: "", label: kind === "start" ? "None" : "Leave Focus as it is" }];
	for (const name of names ?? []) choices.push({ value: name, label: name });
	if (current !== "" && !names?.includes(current)) {
		choices.push({ value: current, label: names === undefined ? current : `${current} (not found)` });
	}
	return choices;
}
