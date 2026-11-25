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
	it("keeps a custom ring background and number color when idle and running", () => {
		const style = parseKeyStyle({ color: "#ffffff", backgroundColor: "#164a72" });
		const idle = pixels({ keyId: "a", state: "idle", minutes: 5, style });
		const running = pixels({ keyId: "a", state: "running", minutes: 5, ring: 1, style });
		expect(colorAt(idle, 4, 4)).toBe("#164a72");
		expect(colorAt(running, 4, 4)).toBe("#164a72");
		expect(renderKeySvg({ keyId: "a", state: "running", minutes: 5, ring: 1, style })).toContain('fill="#ffffff"');
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
