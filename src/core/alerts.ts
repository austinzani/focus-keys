/**
 * Completion alert preferences, shared by every timer key (Stream Deck plugin global settings), and the
 * decision of what to do when a session completes. No SDK or OS imports; adapters play and notify.
 */

/** Built-in macOS sounds offered as completion sounds. Each id is the lowercase name of a file in /System/Library/Sounds. */
export const SOUND_IDS = ["glass", "hero", "ping", "submarine", "funk", "blow", "purr", "tink"] as const;
export type SoundId = (typeof SOUND_IDS)[number];

/** Global settings as the Property Inspector saves them. Anything may be missing or malformed. */
export type AlertSettings = { sound?: unknown; notificationEnabled?: unknown; notificationText?: unknown };

/** Validated alert settings. */
export type AlertPrefs = { sound: SoundId | "none"; notificationEnabled: boolean; notificationText: string };

/** What to do for one completed session. A missing field means do nothing of that kind. */
export type AlertPlan = { sound?: SoundId; notification?: { title: string; body: string } };

export const DEFAULT_SOUND: SoundId = "glass";
/** `{minutes}` is replaced with the finished session's length in whole minutes. */
export const DEFAULT_NOTIFICATION_TEXT = "Time's up: {minutes}-minute timer finished.";
export const NOTIFICATION_TITLE = "Focus Keys";
/** Longer text is cut (in characters); macOS truncates long banners anyway. */
export const MAX_NOTIFICATION_TEXT = 200;

/** Unknown sounds fall back to the default; only `true` enables the notification; blank text uses the default text. */
export function parseAlertPrefs(settings: AlertSettings | undefined): AlertPrefs {
	const sound = settings?.sound === "none" || isSoundId(settings?.sound) ? settings.sound : DEFAULT_SOUND;
	const text = typeof settings?.notificationText === "string" ? settings.notificationText.trim() : "";
	return {
		sound,
		notificationEnabled: settings?.notificationEnabled === true,
		notificationText: text === "" ? DEFAULT_NOTIFICATION_TEXT : text,
	};
}

/** Sound and notification are independent: either, both or neither. */
export function planAlert(prefs: AlertPrefs, durationMs: number): AlertPlan {
	const plan: AlertPlan = {};
	if (prefs.sound !== "none") plan.sound = prefs.sound;
	if (prefs.notificationEnabled) {
		const minutes = String(Math.round(durationMs / 60_000));
		// Cut by code point so an emoji is never split in half.
		const body = [...prefs.notificationText.replaceAll("{minutes}", minutes)].slice(0, MAX_NOTIFICATION_TEXT).join("");
		plan.notification = { title: NOTIFICATION_TITLE, body };
	}
	return plan;
}

function isSoundId(value: unknown): value is SoundId {
	return (SOUND_IDS as readonly unknown[]).includes(value);
}
