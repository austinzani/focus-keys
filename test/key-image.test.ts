import { describe, expect, it } from "vitest";

import { keyImageDataUrl, renderKeySvg } from "../src/render/key-image";

const numberText = (svg: string) => svg.match(/<text[^>]*>([^<]*)<\/text>/)?.[1];
const progressArc = (svg: string) => svg.match(/<circle[^>]*data-role="progress"[^>]*\/>/)?.[0];

describe("key image", () => {
	it("draws an idle key as its large duration number with no progress arc", () => {
		const svg = renderKeySvg({ keyId: "k", state: "idle", minutes: 5 });

		expect(numberText(svg)).toBe("5");
		expect(progressArc(svg)).toBeUndefined();
		expect(svg).not.toMatch(/:\d\d/); // never seconds
	});

	it("draws a running key with its minutes and an arc covering the remaining fraction", () => {
		const full = renderKeySvg({ keyId: "k", state: "running", minutes: 5, ring: 1 });
		const half = renderKeySvg({ keyId: "k", state: "running", minutes: 3, ring: 0.5 });

		expect(numberText(half)).toBe("3");
		const dash = (svg: string) => progressArc(svg)?.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/)?.slice(1).map(Number);
		const [fullOn, circumference] = dash(full)!;
		expect(fullOn).toBeCloseTo(circumference);
		const [halfOn] = dash(half)!;
		expect(halfOn).toBeCloseTo(circumference / 2);
	});

	it("draws a finished key as 0 with no arc", () => {
		const svg = renderKeySvg({ keyId: "k", state: "done", minutes: 0 });

		expect(numberText(svg)).toBe("0");
		expect(progressArc(svg)).toBeUndefined();
	});

	it("wraps the SVG as a URL-encoded data URL for Stream Deck", () => {
		const url = keyImageDataUrl({ keyId: "k", state: "idle", minutes: 15 });

		expect(url.startsWith("data:image/svg+xml,")).toBe(true);
		expect(numberText(decodeURIComponent(url.slice("data:image/svg+xml,".length)))).toBe("15");
	});
});
