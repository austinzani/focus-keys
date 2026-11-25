import { describe, expect, it } from "vitest";

import { SHORTCUT_PICKERS } from "../src/focus/picker";
import { piSource, runPiScript } from "./support";

describe("Property Inspector notification text", () => {
	it("is not bound by a `setting` attribute, which would save on every keystroke", () => {
		expect(piSource()).toMatch(/<sdpi-textarea id="notificationText"/);
		expect(piSource()).not.toMatch(/<sdpi-textarea[^>]*\ssetting=/);
	});

	it("saves the shared global setting once when the field loses focus, never per keystroke or on Enter", () => {
		const pi = runPiScript();
		pi.type("notificationText", "Stretch\nthen water");
		expect(pi.saved.global).toEqual([]);

		pi.blur("notificationText");
		expect(pi.saved.global).toEqual([{ key: "notificationText", value: "Stretch\nthen water" }]);
		expect(pi.saved.settings).toEqual([]);
	});

	it("saves once when the inspector closes", () => {
		const pi = runPiScript();
		pi.type("notificationText", "Done");
		pi.close();
		expect(pi.saved.global.filter((s) => s.key === "notificationText")).toEqual([{ key: "notificationText", value: "Done" }]);
	});
});

describe("Property Inspector duration", () => {
	it("saves the per-key setting on Enter or blur, never per keystroke", () => {
		const pi = runPiScript();
		pi.type("duration", "60");
		expect(pi.saved.settings).toEqual([]);
		pi.enter("duration");
		expect(pi.saved.settings).toEqual([{ key: "durationMinutes", value: "60" }]);
		pi.blur("duration");
		expect(pi.saved.settings).toHaveLength(2);
		expect(pi.saved.global).toEqual([]);
	});

	it("commits without the sdpi debounce", () => {
		expect(runPiScript().delays).toEqual([undefined, null, null]);
	});
});

describe("Property Inspector appearance", () => {
	it("exposes one background and separate ring and sweep controls", () => {
		const source = piSource();
		expect(source).toMatch(/<sdpi-color setting="backgroundColor"/);
		expect(source).toMatch(/<sdpi-color setting="color"/);
		expect(source).toMatch(/<sdpi-color setting="ringColor"/);
		expect(source).toMatch(/<sdpi-color setting="sweepNumber"/);
		expect(source).toMatch(/<sdpi-color setting="sweepEnd"/);
		expect(source).not.toMatch(/setting="sweepBackground"/);
	});

	it("switches controls on local style selection and restored settings", () => {
		const pi = runPiScript();
		pi.selectStyle("sweep-horizontal");
		expect(pi.field("ringColors").hidden).toBe(true);
		expect(pi.field("sweepColors").hidden).toBe(false);
		pi.selectStyle("ring");
		expect(pi.field("ringColors").hidden).toBe(false);
		expect(pi.field("sweepColors").hidden).toBe(true);
		pi.settingsChanged("visualStyle", "sweep-vertical");
		expect(pi.field("ringColors").hidden).toBe(true);
		expect(pi.field("sweepColors").hidden).toBe(false);
	});
});

describe("Property Inspector Focus section", () => {
	const tag = (setting: string) => new RegExp(`<sdpi-[a-z]+[^>]*setting="${setting}"[^>]*>`).exec(piSource())?.[0] ?? "";

	it("saves every Focus setting as a shared global setting, off unless checked", () => {
		expect(tag("focusEnabled")).toMatch(/^<sdpi-checkbox[^>]*\sglobal\b/);
		expect(tag("focusEnabled")).not.toMatch(/default=/);
		expect(tag("focusStartShortcut")).toMatch(/\sglobal\b/);
		expect(tag("focusEndShortcut")).toMatch(/\sglobal\b/);
	});

	it("fills each shortcut picker from the plugin's matching data source", () => {
		const sources = [tag("focusStartShortcut"), tag("focusEndShortcut")].map((t) => /datasource="([^"]+)"/.exec(t)?.[1]);
		expect(sources).toEqual(Object.keys(SHORTCUT_PICKERS));
		expect(Object.values(SHORTCUT_PICKERS)).toEqual(["start", "end"]);
	});

	it("asks the plugin for the latest Focus problem when it loads, so it never misses one sent before it connected", () => {
		expect(runPiScript().sent).toEqual([{ event: "sendToPlugin", payload: { event: "focusStatus" } }]);
	});

	it("shows the plugin's latest Focus problem as plain text, and hides the line when there is none", () => {
		const pi = runPiScript();
		const status = pi.field("focusStatus");
		pi.fromPlugin({ event: "focusStatus", message: 'No shortcut named "<b>Work</b>"' });
		expect(status.textContent).toBe('Last Focus problem — No shortcut named "<b>Work</b>"');
		expect(status.hidden).toBe(false);
		pi.fromPlugin({ event: "focusStatus", message: "" });
		expect(status.hidden).toBe(true);
		pi.fromPlugin({ event: "focusStartShortcuts", items: [] });
		expect(status.hidden).toBe(true);
	});
});
