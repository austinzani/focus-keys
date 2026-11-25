import { describe, expect, it } from "vitest";

import { FONT_IDS, VISUAL_STYLES, legacySweepBackground, parseKeyStyle } from "../src/core/key-style";
import { GLYPH_FONTS } from "../src/render/glyphs.generated";
import { piOptions } from "./support";

describe("key style settings", () => {
	it("offers five fonts, defaulting to Inter and the tomato ring color", () => {
		expect(FONT_IDS).toEqual(["inter", "nunito", "oswald", "jetbrains-mono", "bitter"]);
		expect(parseKeyStyle({})).toMatchObject({ color: "#ff6347", font: "inter", visualStyle: "ring", backgroundColor: "#111111", sweepNumber: "white" });
	});

	it("has bundled digit outlines and a Property Inspector option for every font", () => {
		expect(Object.keys(GLYPH_FONTS)).toEqual([...FONT_IDS]);
		expect(piOptions("font")).toEqual([...FONT_IDS]);
	});

	it("validates per-key styles and independent backgrounds and sweep numbers", () => {
		expect(piOptions("visualStyle")).toEqual([...VISUAL_STYLES]);
		expect(piOptions("sweepNumber")).toEqual(["white", "black"]);
		expect(piOptions("sweepEnd")).toEqual(["white", "black"]);
		expect(parseKeyStyle({ visualStyle: "sweep-vertical", backgroundColor: "#eee", sweepBackground: "#1A2B3C", sweepNumber: "black" })).toMatchObject({
			visualStyle: "sweep-vertical", backgroundColor: "#eeeeee", sweepBackground: "#eeeeee", sweepNumber: "black",
		});
		expect(parseKeyStyle({ visualStyle: "unknown", backgroundColor: "bad", sweepBackground: "bad", sweepNumber: "blue" })).toMatchObject({
			visualStyle: "ring", backgroundColor: "#111111", sweepBackground: "#111111", sweepNumber: "white",
		});
	});

	it("preserves and migrates an older sweep background without overwriting a chosen background", () => {
		const old = { visualStyle: "sweep-vertical", sweepBackground: "#1A2B3C" };
		expect(parseKeyStyle(old).backgroundColor).toBe("#1a2b3c");
		expect(legacySweepBackground(old)).toBe("#1a2b3c");
		expect(legacySweepBackground({ ...old, backgroundColor: "#ff8800" })).toBeUndefined();
		expect(legacySweepBackground({ ...old, visualStyle: "ring" })).toBeUndefined();
		expect(legacySweepBackground({ ...old, sweepBackground: "invalid" })).toBeUndefined();
	});

	it("keeps a valid font and color, lowercasing and expanding short hex", () => {
		expect(parseKeyStyle({ color: "#1E90FF", font: "oswald" })).toMatchObject({ color: "#1e90ff", font: "oswald" });
		expect(parseKeyStyle({ color: "#0f0", font: "bitter" })).toMatchObject({ color: "#00ff00", font: "bitter" });
	});

	it("falls back to the defaults for unknown fonts and malformed colors", () => {
		for (const color of ["red", "#12345", "#gggggg", 42, null, "", " #ff0000"]) {
			expect(parseKeyStyle({ color }).color).toBe("#ff6347");
		}
		for (const font of ["comic-sans", "Inter", 3, null, ""]) {
			expect(parseKeyStyle({ font }).font).toBe("inter");
		}
	});

	it("preserves chosen number and background colors exactly", () => {
		expect(parseKeyStyle({ color: "#ffffff", backgroundColor: "#ff8800" })).toMatchObject({ color: "#ffffff", backgroundColor: "#ff8800" });
		expect(parseKeyStyle({ color: "#000080" }).color).toBe("#000080");
		expect(parseKeyStyle({ color: "#000000" }).color).toBe("#000000");
	});

	it("keeps ring and number colors independent and preserves older defaults", () => {
		expect(parseKeyStyle({ color: "#ffffff", ringColor: "#123456" })).toMatchObject({ color: "#ffffff", ringColor: "#123456" });
		expect(parseKeyStyle({ color: "#abcdef" }).ringColor).toBe("#abcdef");
		expect(parseKeyStyle({ sweepNumber: "black" }).sweepEnd).toBe("black");
		expect(parseKeyStyle({ sweepNumber: "black", sweepEnd: "white" })).toMatchObject({ sweepNumber: "black", sweepEnd: "white" });
	});
});
