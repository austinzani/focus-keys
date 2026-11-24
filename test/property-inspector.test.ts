import { describe, expect, it } from "vitest";

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
		expect(runPiScript().delays).toEqual([null, null]);
	});
});
