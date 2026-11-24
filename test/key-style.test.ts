import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { FONT_IDS, parseKeyStyle } from "../src/core/key-style";
import { GLYPH_FONTS } from "../src/render/glyphs.generated";

describe("key style settings", () => {
	it("offers five fonts, defaulting to Inter and the tomato ring color", () => {
		expect(FONT_IDS).toEqual(["inter", "nunito", "oswald", "jetbrains-mono", "bitter"]);
		expect(parseKeyStyle({})).toEqual({ color: "#ff6347", font: "inter" });
	});

	it("has bundled digit outlines and a Property Inspector option for every font", () => {
		expect(Object.keys(GLYPH_FONTS)).toEqual([...FONT_IDS]);
		const html = readFileSync(new URL("../com.austinzani.neo-pomodoro.sdPlugin/ui/preset.html", import.meta.url), "utf8");
		const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
		expect(options).toEqual([...FONT_IDS]);
	});

	it("keeps a valid font and color, lowercasing and expanding short hex", () => {
		expect(parseKeyStyle({ color: "#1E90FF", font: "oswald" })).toEqual({ color: "#1e90ff", font: "oswald" });
		expect(parseKeyStyle({ color: "#0f0", font: "bitter" })).toEqual({ color: "#00ff00", font: "bitter" });
	});

	it("falls back to the defaults for unknown fonts and malformed colors", () => {
		for (const color of ["red", "#12345", "#gggggg", 42, null, "", " #ff0000"]) {
			expect(parseKeyStyle({ color }).color).toBe("#ff6347");
		}
		for (const font of ["comic-sans", "Inter", 3, null, ""]) {
			expect(parseKeyStyle({ font }).font).toBe("inter");
		}
	});

	it("lightens a color too dark to see on the dark key until it has 4.5:1 contrast", () => {
		const navy = parseKeyStyle({ color: "#000080" }).color;
		expect(navy).not.toBe("#000080");
		expect(contrastOnKey(navy)).toBeGreaterThanOrEqual(4.5);
		expect(contrastOnKey(navy)).toBeLessThan(5.5); // lightened only as much as needed
		expect(parseKeyStyle({ color: "#000000" }).color).not.toBe("#000000");
		// Already visible colors are kept exactly.
		expect(parseKeyStyle({ color: "#ffd700" }).color).toBe("#ffd700");
	});
});

/** WCAG contrast against the key background #111111, computed independently of the implementation. */
function contrastOnKey(hex: string): number {
	const lum = (h: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
	};
	return (lum(hex) + 0.05) / (lum("#111111") + 0.05);
}
