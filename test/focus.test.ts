import { describe, expect, it } from "vitest";

import { shortcutChoices } from "../src/core/focus";
import { answerShortcutPicker } from "../src/focus/picker";

describe("shortcut choices offered in the Focus settings", () => {
	it("offers running nothing first, then the user's shortcuts", () => {
		expect(shortcutChoices("start", ["Focus Off", "Work Focus"], "")).toEqual([
			{ value: "", label: "None" },
			{ value: "Focus Off", label: "Focus Off" },
			{ value: "Work Focus", label: "Work Focus" },
		]);
		expect(shortcutChoices("end", ["Focus Off"], "Focus Off")[0]).toEqual({ value: "", label: "Leave Focus as it is" });
	});

	it("keeps a chosen shortcut that no longer exists, marked so the user can fix it", () => {
		expect(shortcutChoices("end", ["Work Focus"], "Old Focus Off")).toEqual([
			{ value: "", label: "Leave Focus as it is" },
			{ value: "Work Focus", label: "Work Focus" },
			{ value: "Old Focus Off", label: "Old Focus Off (not found)" },
		]);
	});

	it("keeps the chosen shortcut when the list could not be read", () => {
		expect(shortcutChoices("start", undefined, "Work Focus")).toEqual([
			{ value: "", label: "None" },
			{ value: "Work Focus", label: "Work Focus" },
		]);
	});
});

describe("answering the Focus settings' shortcut pickers", () => {
	const ports = (names: string[] | Error, settings = {}) => ({
		list: async () => {
			if (names instanceof Error) throw names;
			return names;
		},
		loadSettings: async () => settings,
		log: { info: () => {}, error: () => {} },
	});

	it("answers the start picker with the user's shortcuts and the current choice", async () => {
		const reply = await answerShortcutPicker({ event: "focusStartShortcuts" }, ports(["Work Focus"], { focusStartShortcut: "Gone" }));
		expect(reply).toEqual({
			event: "focusStartShortcuts",
			items: [
				{ value: "", label: "None" },
				{ value: "Work Focus", label: "Work Focus" },
				{ value: "Gone", label: "Gone (not found)" },
			],
		});
	});

	it("answers the end picker even when the shortcuts can't be listed", async () => {
		const reply = await answerShortcutPicker({ event: "focusEndShortcuts", isRefresh: true }, ports(new Error("ENOENT"), { focusEndShortcut: "Focus Off" }));
		expect(reply?.items).toEqual([
			{ value: "", label: "Leave Focus as it is" },
			{ value: "Focus Off", label: "Focus Off" },
		]);
	});

	it.each([[{ event: "other" }], ["focusStartShortcuts"], [null]])("ignores other messages: %j", async (message) => {
		expect(await answerShortcutPicker(message, ports(["Work Focus"]))).toBeUndefined();
	});
});
