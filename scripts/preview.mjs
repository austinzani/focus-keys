// Renders every font x key state to PNG contact sheets at key sizes 72 and 144 px (the SDK's 1x and @2x)
// and 96 px (the Neo's physical key panel, per the python-elgato-streamdeck device table),
// using resvg as an off-device stand-in for Stream Deck's SVG rasterizer. Not a substitute for checking
// the physical Neo. Usage: npm run preview -- [output dir]   (default: ./preview, which git ignores)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "preview"));
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
	const { renderKeySvg } = await server.ssrLoadModule("/src/render/key-image.ts");
	const { FONT_IDS, parseKeyStyle } = await server.ssrLoadModule("/src/core/key-style.ts");

	const states = [
		...[5, 15, 30, 60, 180].map((minutes) => ({ label: `idle ${minutes}`, state: "idle", minutes })),
		{ label: "running 12", state: "running", minutes: 12, ring: 0.4 },
		{ label: "running 147", state: "running", minutes: 147, ring: 0.82 },
		{ label: "paused 12", state: "paused", minutes: 12, ring: 0.4 },
		{ label: "done", state: "done", minutes: 0 },
	];
	const colors = ["#ff6347", "#1e90ff", "#32cd32", "#ffd700", "#ffffff", "#000080"];

	const sheet = (rows, key) => {
		const pad = 8;
		const labelW = 120;
		const cols = Math.max(...rows.map((r) => r.cells.length));
		const w = labelW + cols * (key + pad) + pad;
		const h = 24 + rows.length * (key + pad) + pad;
		let body = `<rect width="${w}" height="${h}" fill="#000"/>`;
		rows[0].cells.forEach((c, i) => {
			body += `<text x="${labelW + i * (key + pad) + key / 2}" y="16" fill="#aaa" font-size="11" font-family="Helvetica" text-anchor="middle">${c.label}</text>`;
		});
		rows.forEach((r, j) => {
			const y = 24 + j * (key + pad);
			body += `<text x="6" y="${y + key / 2 + 4}" fill="#ddd" font-size="12" font-family="Helvetica">${r.label}</text>`;
			r.cells.forEach((c, i) => {
				const inner = c.svg.replace(/^<svg [^>]*>/, "").replace(/<\/svg>$/, "");
				body += `<svg x="${labelW + i * (key + pad)}" y="${y}" width="${key}" height="${key}" viewBox="0 0 144 144">${inner}</svg>`;
			});
		});
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
	};
	const png = (svg) => new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();

	const fontRows = FONT_IDS.map((font) => ({
		label: font,
		cells: states.map((s) => ({ label: s.label, svg: renderKeySvg({ keyId: "k", ...s, style: { ...parseKeyStyle({}), font } }) })),
	}));
	const colorRows = colors.map((color) => ({
		label: color,
		cells: ["idle", "running", "paused"].map((state) => ({
			label: state,
			svg: renderKeySvg({ keyId: "k", state, minutes: 25, ring: 0.6, style: parseKeyStyle({ color }) }),
		})),
	}));

	for (const [name, rows] of [["fonts", fontRows], ["colors", colorRows]]) {
		for (const key of [72, 96, 144]) {
			const file = join(outDir, `${name}-${key}.png`);
			writeFileSync(file, png(sheet(rows, key)));
			console.log(file);
		}
	}
} finally {
	await server.close();
}
