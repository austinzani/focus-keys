import { describe, expect, it } from "vitest";

import { MAX_NOTIFICATION_TEXT, parseAlertPrefs, planAlert, SOUND_IDS } from "../src/core/alerts";
import { piOptions, piSource } from "./support";

const MIN = 60_000;

describe("alert preferences", () => {
	it("default to the Glass sound and no notification when nothing is saved", () => {
		expect(planAlert(parseAlertPrefs({}), 25 * MIN)).toEqual({ sound: "glass" });
		expect(planAlert(parseAlertPrefs(undefined), 25 * MIN)).toEqual({ sound: "glass" });
	});

	it("offer silence: no sound is requested", () => {
		expect(planAlert(parseAlertPrefs({ sound: "none" }), 5 * MIN)).toEqual({});
	});

	it("use the selected sound, and the default for an unknown one", () => {
		expect(planAlert(parseAlertPrefs({ sound: "submarine" }), 5 * MIN)).toEqual({ sound: "submarine" });
		for (const sound of ["Glass", "../../etc/passwd", 3, null, ""]) {
			expect(planAlert(parseAlertPrefs({ sound }), 5 * MIN)).toEqual({ sound: "glass" });
		}
	});

	it("show a notification only when enabled, independently of the sound", () => {
		expect(planAlert(parseAlertPrefs({ sound: "none", notificationEnabled: true, notificationText: "Stretch" }), 5 * MIN)).toEqual({
			notification: { title: "Neo Pomodoro", body: "Stretch" },
		});
		expect(planAlert(parseAlertPrefs({ sound: "ping", notificationEnabled: true, notificationText: "Stretch" }), 5 * MIN)).toEqual({
			sound: "ping",
			notification: { title: "Neo Pomodoro", body: "Stretch" },
		});
		for (const notificationEnabled of [false, "true", 1, undefined]) {
			expect(planAlert(parseAlertPrefs({ notificationEnabled, notificationText: "Stretch" }), 5 * MIN).notification).toBeUndefined();
		}
	});

	it("fill {minutes} with the finished session's length", () => {
		const prefs = parseAlertPrefs({ notificationEnabled: true, notificationText: "{minutes} min done, {minutes} again" });
		expect(planAlert(prefs, 15 * MIN).notification?.body).toBe("15 min done, 15 again");
	});

	it("use the default text when the saved text is blank", () => {
		for (const notificationText of ["", "   ", undefined, 7]) {
			const prefs = parseAlertPrefs({ notificationEnabled: true, notificationText });
			expect(planAlert(prefs, 25 * MIN).notification?.body).toBe("Time's up: 25-minute timer finished.");
		}
	});

	it("keep the user's text as written, only trimming and capping its length", () => {
		const text = ` Say "hi" \\ to 🍅\nnow `;
		expect(planAlert(parseAlertPrefs({ notificationEnabled: true, notificationText: text }), MIN).notification?.body).toBe(`Say "hi" \\ to 🍅\nnow`);
		const long = "x".repeat(500);
		expect(planAlert(parseAlertPrefs({ notificationEnabled: true, notificationText: long }), MIN).notification?.body).toHaveLength(200);
	});

	it("has a Property Inspector option for every sound, plus silence", () => {
		expect(piOptions("sound")).toEqual([...SOUND_IDS, "none"]);
	});

	it("lets the Property Inspector accept exactly as much text as a notification shows", () => {
		expect(piSource()).toMatch(new RegExp(`<sdpi-textarea[^>]*id="notificationText"[^>]*maxlength="${MAX_NOTIFICATION_TEXT}"`));
	});
});
