import { describe, expect, it } from "vitest";

import { FONT_IDS, type FontId } from "../src/core/key-style";
import type { KeyRender } from "../src/core/coordinator";
import { GLYPH_FONTS } from "../src/render/glyphs.generated";
import { keyImageDataUrl, renderKeySvg } from "../src/render/key-image";

const style = { color: "#1e90ff", font: "inter" as FontId };
const idle = (minutes: number, s = style): KeyRender => ({ keyId: "k", state: "idle", minutes, style: s });
const running = (minutes: number, ring: number): KeyRender => ({ keyId: "k", state: "running", minutes, ring, style });
const paused = (minutes: number, ring: number): KeyRender => ({ keyId: "k", state: "paused", minutes, ring, style });

const numberGroup = (svg: string) => svg.match(/<g data-role="number"[^>]*>/)?.[0];
const numberText = (svg: string) => numberGroup(svg)?.match(/data-text="([^"]*)"/)?.[1];
const numberFill = (svg: string) => numberGroup(svg)?.match(/fill="([^"]+)"/)?.[1];
const digitPaths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
const progressArc = (svg: string) => svg.match(/<circle[^>]*data-role="progress"[^>]*\/>/)?.[0];
const arcStroke = (svg: string) => progressArc(svg)?.match(/stroke="([^"]+)"/)?.[1];

describe("key image", () => {
	it("draws an idle key as its large duration number in the key's color, with no progress arc", () => {
		const svg = renderKeySvg(idle(5));

		expect(numberText(svg)).toBe("5");
		expect(numberFill(svg)).toBe("#1e90ff");
		expect(progressArc(svg)).toBeUndefined();
		expect(svg).not.toMatch(/:\d\d/); // never seconds
	});

	it.each(FONT_IDS.map((f) => [f]))("draws the number from the bundled %s digit outlines, not an installed font", (font) => {
		const svg = renderKeySvg(idle(15, { ...style, font }));

		expect(digitPaths(svg)).toEqual([GLYPH_FONTS[font]!.digits["1"]!.d, GLYPH_FONTS[font]!.digits["5"]!.d]);
		expect(svg).not.toContain("<text");
	});

	it("falls back to the default font's outlines for an unknown font", () => {
		const svg = renderKeySvg(idle(7, { ...style, font: "missing" as FontId }));

		expect(digitPaths(svg)).toEqual([GLYPH_FONTS.inter!.digits["7"]!.d]);
	});

	it("falls back to the default font's outlines when the chosen font lacks a needed digit", () => {
		const { "7": _missing, ...digits } = GLYPH_FONTS.oswald!.digits;
		const fonts = { ...GLYPH_FONTS, oswald: { ...GLYPH_FONTS.oswald!, digits } };

		const svg = renderKeySvg(idle(17, { ...style, font: "oswald" }), fonts);

		expect(digitPaths(svg)).toEqual([GLYPH_FONTS.inter!.digits["1"]!.d, GLYPH_FONTS.inter!.digits["7"]!.d]);
	});

	it("falls back to plain SVG text with generic fonts when no outlines are available", () => {
		const svg = renderKeySvg(idle(30), {});

		expect(svg).toMatch(/<text[^>]*font-family="[^"]*sans-serif"[^>]*>30<\/text>/);
		expect(svg).toMatch(/<g data-role="number" data-text="30" fill="#1e90ff">/);
	});

	it("draws a running key with a white number and an arc in the key's color covering the remaining fraction", () => {
		const full = renderKeySvg(running(5, 1));
		const half = renderKeySvg(running(3, 0.5));

		expect(numberText(half)).toBe("3");
		expect(numberFill(half)).toBe("#f5f5f5");
		expect(arcStroke(half)).toBe("#1e90ff");
		const dash = (svg: string) => progressArc(svg)?.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/)?.slice(1).map(Number);
		const [fullOn, circumference] = dash(full)!;
		expect(fullOn).toBeCloseTo(circumference!);
		const [halfOn] = dash(half)!;
		expect(halfOn).toBeCloseTo(circumference! / 2);
	});

	it("draws a paused key with the same frozen arc in a muted shade of its color and a dimmed number", () => {
		const run = renderKeySvg(running(4, 0.7));
		const pause = renderKeySvg(paused(4, 0.7));
		const dashOn = (svg: string) => progressArc(svg)?.match(/stroke-dasharray="([\d.]+)/)?.[1];

		expect(numberText(pause)).toBe("4");
		expect(dashOn(pause)).toBe(dashOn(run));
		// #1e90ff mixed 60% toward grey #5a5a5a: still blue-ish, clearly darker than running.
		expect(arcStroke(pause)).toBe("#42709c");
		expect(numberFill(pause)).toBe("#a3a3a3");
		expect(numberFill(pause)).not.toBe(numberFill(run));
	});

	it("draws a finished key as a white 0 with no arc", () => {
		const svg = renderKeySvg({ keyId: "k", state: "done", minutes: 0, style });

		expect(numberText(svg)).toBe("0");
		expect(numberFill(svg)).toBe("#f5f5f5");
		expect(progressArc(svg)).toBeUndefined();
	});

	it.each(FONT_IDS.map((f) => [f]))("fits the widest number, 180, inside the ring in %s", (font) => {
		const svg = renderKeySvg(idle(180, { ...style, font }));
		const [, x, y, s] = numberGroup(svg)!.match(/translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/)!.map(Number);
		const g = GLYPH_FONTS[font]!;
		const pens = [0, g.digits["1"]!.advance, g.digits["1"]!.advance + g.digits["8"]!.advance];
		const left = x! + (pens[0]! + g.digits["1"]!.xMin) * s!;
		const right = x! + (pens[2]! + g.digits["0"]!.xMax) * s!;
		const top = y! - g.top * s!;
		const bottom = y! - g.bottom * s!;
		// The ink box's farthest corner sits on the 54 px circle around the 72,72 center: as large as fits while
		// keeping a 4 px gap inside the ring's inner edge (radius 58). Slack covers only the SVG's 2-decimal rounding.
		const reach = Math.max(...[[left, top], [right, top], [left, bottom], [right, bottom]].map(([cx, cy]) => Math.hypot(cx! - 72, cy! - 72)));
		expect(reach).toBeLessThanOrEqual(54.01);
		expect(reach).toBeGreaterThanOrEqual(53.99);
		expect((left + right) / 2).toBeCloseTo(72, 0);
		expect((top + bottom) / 2).toBeCloseTo(72, 0);
	});

	it("wraps the SVG as a URL-encoded data URL for Stream Deck", () => {
		const url = keyImageDataUrl(idle(15));

		expect(url.startsWith("data:image/svg+xml,")).toBe(true);
		expect(numberText(decodeURIComponent(url.slice("data:image/svg+xml,".length)))).toBe("15");
	});
});
