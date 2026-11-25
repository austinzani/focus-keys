import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";

import type { KeyRender } from "../src/core/coordinator";
import { parseKeyStyle } from "../src/core/key-style";
import { renderKeySvg } from "../src/render/key-image";

function pixels(render: KeyRender) {
	return new Resvg(renderKeySvg(render)).render().pixels;
}

function colorAt(data: Buffer, x: number, y: number): string {
	return `#${data.subarray((y * 144 + x) * 4, (y * 144 + x) * 4 + 3).toString("hex")}`;
}

describe("visual styles rendered as pixels", () => {
	it("keeps a white ring number exactly white on an orange background", () => {
		const style = parseKeyStyle({ color: "#ffffff", backgroundColor: "#ff8800" });
		const render: KeyRender = { keyId: "a", state: "idle", minutes: 5, style };
		const data = pixels(render);
		expect(colorAt(data, 4, 4)).toBe("#ff8800");
		let whitePixels = 0;
		for (let y = 35; y < 110; y++) for (let x = 35; x < 110; x++) {
			if (colorAt(data, x, y) === "#ffffff") whitePixels++;
		}
		expect(whitePixels).toBeGreaterThan(10);
	});

	it("uses the chosen background when switching from ring to sweep", () => {
		const style = parseKeyStyle({ visualStyle: "sweep-horizontal", color: "#ffffff", backgroundColor: "#ff8800" });
		const data = pixels({ keyId: "a", state: "idle", minutes: 5, style });
		expect(colorAt(data, 4, 4)).toBe("#ff8800");
	});

	it.each(["sweep-horizontal", "sweep-vertical"])("shows a white number on the selected background for %s", (visualStyle) => {
		const style = parseKeyStyle({ visualStyle, sweepNumber: "#ffffff", backgroundColor: "#ff8800", sweepEnd: "#000000" });
		const data = pixels({ keyId: "a", state: "idle", minutes: 5, style });
		let whitePixels = 0;
		for (let y = 35; y < 110; y++) for (let x = 35; x < 110; x++) {
			if (colorAt(data, x, y) === "#ffffff") whitePixels++;
		}
		expect(colorAt(data, 4, 4)).toBe("#ff8800");
		expect(whitePixels).toBeGreaterThan(10);
	});
	it("keeps a custom ring background and number color when idle and running", () => {
		const style = parseKeyStyle({ color: "#ffffff", ringColor: "#ff8800", backgroundColor: "#164a72" });
		const idle = pixels({ keyId: "a", state: "idle", minutes: 5, style });
		const running = pixels({ keyId: "a", state: "running", minutes: 5, ring: 1, style });
		expect(colorAt(idle, 4, 4)).toBe("#164a72");
		expect(colorAt(running, 4, 4)).toBe("#164a72");
		expect(renderKeySvg({ keyId: "a", state: "running", minutes: 5, ring: 1, style })).toContain('fill="#ffffff"');
		expect(renderKeySvg({ keyId: "a", state: "running", minutes: 5, ring: 1, style })).toContain('stroke="#ff8800"');
	});

	it("lets the sweep color differ from the starting number color", () => {
		const style = parseKeyStyle({ visualStyle: "sweep-horizontal", backgroundColor: "#ff8800", sweepNumber: "white", sweepEnd: "black" });
		const data = pixels({ keyId: "a", state: "running", minutes: 3, ring: 0.5, style });
		expect(colorAt(data, 10, 10)).toBe("#000000");
		expect(colorAt(data, 130, 10)).toBe("#ff8800");
		const svg = renderKeySvg({ keyId: "a", state: "running", minutes: 3, ring: 0.5, style });
		expect(svg).toContain('data-text="3" fill="#ffffff"');
	});

	it.each(["sweep-horizontal", "sweep-vertical"])("renders custom sweep and number colors for %s", (visualStyle) => {
		const style = parseKeyStyle({ visualStyle, backgroundColor: "#ff8800", sweepNumber: "#33ff44", sweepEnd: "#0066cc" });
		const render: KeyRender = { keyId: "a", state: "running", minutes: 3, ring: 0.5, style };
		const data = pixels(render);
		const vertical = visualStyle === "sweep-vertical";
		expect(colorAt(data, 10, 10)).toBe("#0066cc");
		expect(colorAt(data, vertical ? 10 : 130, vertical ? 130 : 10)).toBe("#ff8800");
		let originalPixels = 0;
		let coveredPixels = 0;
		for (let y = 35; y < 110; y++) for (let x = 35; x < 110; x++) {
			if ((vertical ? y : x) >= 72 && colorAt(data, x, y) === "#33ff44") originalPixels++;
			if ((vertical ? y : x) < 72 && colorAt(data, x, y) === "#ffffff") coveredPixels++;
		}
		expect(originalPixels).toBeGreaterThan(10);
		expect(coveredPixels).toBeGreaterThan(10);
	});

	it.each([
		["sweep-horizontal", "white", "#ffffff", "#a04030"],
		["sweep-vertical", "white", "#ffffff", "#a04030"],
		["sweep-horizontal", "black", "#000000", "#a04030"],
		["sweep-vertical", "black", "#000000", "#a04030"],
	])("sweeps %s with %s numbers and inverts the covered digits", (visualStyle, sweepNumber, swept, background) => {
		const style = parseKeyStyle({ visualStyle, sweepNumber, sweepBackground: background });
		const half = pixels({ keyId: "a", state: "running", minutes: 3, ring: 0.5, style });
		const vertical = visualStyle === "sweep-vertical";
		expect(colorAt(half, 10, 10)).toBe(swept);
		expect(colorAt(half, vertical ? 10 : 130, vertical ? 130 : 10)).toBe(background);
		const foreground = sweepNumber === "white" ? "#000000" : "#ffffff";
		const original = sweepNumber === "white" ? "#ffffff" : "#000000";
		let invertedPixels = 0;
		let originalPixels = 0;
		for (let y = 35; y < 110; y++) for (let x = 35; x < 110; x++) {
			if ((vertical ? y : x) < 72 && colorAt(half, x, y) === foreground) invertedPixels++;
			if ((vertical ? y : x) >= 72 && colorAt(half, x, y) === original) originalPixels++;
		}
		expect(invertedPixels).toBeGreaterThan(10);
		expect(originalPixels).toBeGreaterThan(10);
	});

	it("starts unswept, freezes when paused and fills the background when done", () => {
		const style = parseKeyStyle({ visualStyle: "sweep-horizontal", sweepBackground: "#a04030" });
		const idle = pixels({ keyId: "a", state: "idle", minutes: 5, style });
		const running = pixels({ keyId: "a", state: "running", minutes: 3, ring: 0.5, style });
		const paused = pixels({ keyId: "a", state: "paused", minutes: 3, ring: 0.5, style });
		const done = pixels({ keyId: "a", state: "done", minutes: 0, style });
		expect(colorAt(idle, 10, 10)).toBe("#a04030");
		expect(paused).toEqual(running);
		expect(colorAt(done, 130, 10)).toBe("#ffffff");
	});
});
