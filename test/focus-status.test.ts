import { describe, expect, it } from "vitest";

import { FocusStatus } from "../src/focus/status";

const ON = { focusEnabled: true, focusStartShortcut: "Work Focus", focusEndShortcut: "Focus Off" };
/** The shared settings hold other keys too, such as the notification text. */
const shared = (settings: Record<string, unknown>) => settings;

function setup() {
	const sent: unknown[] = [];
	const status = new FocusStatus((message) => sent.push(message));
	return { status, sent };
}

describe("Focus problem line in the Property Inspector", () => {
	it("shows the latest failure and clears it once a shortcut runs", () => {
		const t = setup();
		t.status.succeeded();
		expect(t.sent).toEqual([]);
		t.status.failed('No shortcut named "Work Focus"');
		t.status.succeeded();
		t.status.succeeded();
		expect(t.sent).toEqual([
			{ event: "focusStatus", message: 'No shortcut named "Work Focus"' },
			{ event: "focusStatus", message: "" },
		]);
	});

	it("clears when the Focus settings change, but not when other shared settings change", () => {
		const t = setup();
		t.status.settingsSeen(shared({ ...ON, notificationText: "Break" }));
		t.status.failed("Shortcut failed");
		t.status.settingsChanged(shared({ ...ON, notificationText: "Stretch", focusStartShortcut: " Work Focus " }));
		expect(t.sent).toEqual([{ event: "focusStatus", message: "Shortcut failed" }]);
		t.status.settingsChanged({ ...ON, focusStartShortcut: "Reading" });
		expect(t.sent.at(-1)).toEqual({ event: "focusStatus", message: "" });
	});

	it("clears on a settings change when it never saw the settings before, since it can't tell what changed", () => {
		const t = setup();
		t.status.failed("Shortcut failed");
		t.status.settingsChanged(ON);
		expect(t.sent.at(-1)).toEqual({ event: "focusStatus", message: "" });
	});

	it("answers the inspector's request for the current status, and nothing else", () => {
		const t = setup();
		t.status.failed("Shortcut failed");
		expect(t.status.answer({ event: "focusStatus" })).toEqual({ event: "focusStatus", message: "Shortcut failed" });
		expect(t.status.answer({ event: "focusStartShortcuts" })).toBeUndefined();
		expect(t.status.answer("focusStatus")).toBeUndefined();
	});
});
