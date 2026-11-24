// Regenerates the plugin's static images from the real key renderer (src/render/key-image.ts), so the icons match
// what the keys draw: a whole-minute number inside a progress ring, digits from the bundled OFL font outlines.
//   imgs/plugin/marketplace(.png|@2x)   plugin icon, 256 / 512 px, full color
//   imgs/plugin/category-icon           action-list category icon, 28 / 56 px, white on transparent
//   imgs/actions/preset/icon            action-list action icon, 20 / 40 px, white on transparent
//   imgs/actions/preset/key             default key image, 72 / 144 px (a new key's idle 5)
//   imgs/actions/break/icon             Break action-list icon, 20 / 40 px, white cup on transparent
//   imgs/actions/break/key              Break default key image, 72 / 144 px (idle 5 in the break color)
// It also writes the Maker Console app icon (288 px) and gallery mock-ups (1920 x 960) to release/gallery/ (git-ignored; not part of the plugin).
// Usage: npm run icons   (commit the regenerated PNGs)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const imgs = join(root, "com.austinzani.focus-keys.sdPlugin", "imgs");
const galleryDir = join(root, "release", "gallery");
/** Marketplace thumbnail and gallery image size, px (docs.elgato.com/guidelines/products). */
const GALLERY = { width: 1920, height: 960 };

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
const write = (file, data) => {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
	console.log(file);
};
/** The key SVG's content without its <svg> wrapper (drawn in a 144 x 144 box). */
const inner = (svg) => svg.replace(/^<svg [^>]*>/, "").replace(/<\/svg>$/, "");
const KEY_BG = /<rect width="144" height="144" fill="#[0-9a-f]{6}"\/>/i;
/** String.replace that fails if nothing matched, so a renderer change can't silently produce wrong icons. */
const swap = (text, pattern, replacement) => {
	const out = text.replace(pattern, replacement);
	if (out === text) throw new Error(`generate-icons: ${pattern} not found in the key SVG; update this script to match src/render/key-image.ts`);
	return out;
};

const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
	const { renderKeySvg } = await server.ssrLoadModule("/src/render/key-image.ts");
	const { FONT_IDS, parseKeyStyle, KEY_BACKGROUND, BREAK_DEFAULT_COLOR } = await server.ssrLoadModule("/src/core/key-style.ts");
	const key = (state, minutes, ring, settings = {}) => renderKeySvg({ keyId: "k", state, minutes, ring, style: parseKeyStyle(settings) });

	// Plugin icon: a running 25 on a rounded dark tile.
	const iconKey = swap(inner(key("running", 25, 0.7)), KEY_BG, "");
	const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="30" fill="${KEY_BACKGROUND}"/><g transform="translate(7.2 7.2) scale(0.9)">${iconKey}</g></svg>`;
	write(join(imgs, "plugin", "marketplace.png"), png(icon, 256));
	write(join(imgs, "plugin", "marketplace@2x.png"), png(icon, 512));
	write(join(galleryDir, "app-icon-288.png"), png(icon, 288)); // Maker Console app icon

	// Action-list icons: Elgato asks for monochrome white on a transparent background. Thicker ring, no track.
	const mono = (strokeWidth) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		[
			[KEY_BG, ""], // transparent background
			[/<circle [^>]*stroke="#2b2b2b"[^>]*\/>/, ""], // no ring track
			[/(data-role="progress"[^>]*)stroke-width="8"/, `$1stroke-width="${strokeWidth}"`], // thicker ring
			[/#f5f5f5/g, "#ffffff"], // pure white number
		].reduce((svg, [pattern, replacement]) => swap(svg, pattern, replacement), inner(key("running", 5, 0.75, { color: "#ffffff" }))) +
		`</svg>`;
	write(join(imgs, "plugin", "category-icon.png"), png(mono(14), 28));
	write(join(imgs, "plugin", "category-icon@2x.png"), png(mono(12), 56));
	write(join(imgs, "actions", "preset", "icon.png"), png(mono(16), 20));
	write(join(imgs, "actions", "preset", "icon@2x.png"), png(mono(14), 40));

	// Default key image: exactly what a newly placed key shows before the plugin paints it.
	const idle = key("idle", 5);
	write(join(imgs, "actions", "preset", "key.png"), png(idle, 72));
	write(join(imgs, "actions", "preset", "key@2x.png"), png(idle, 144));

	// Break action: a white cup with steam, so it reads differently from the timer preset's ring in the action list.
	const cup = (strokeWidth) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><g fill="none" stroke="#ffffff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M30 62 H100 V92 A28 28 0 0 1 72 120 H58 A28 28 0 0 1 30 92 Z"/>` + // cup
		`<path d="M100 70 H108 A14 14 0 0 1 108 98 H99"/>` + // handle
		`<path d="M52 22 C44 32 60 38 52 48 M74 22 C66 32 82 38 74 48"/>` + // steam
		`</g></svg>`;
	write(join(imgs, "actions", "break", "icon.png"), png(cup(14), 20));
	write(join(imgs, "actions", "break", "icon@2x.png"), png(cup(12), 40));
	const breakIdle = key("idle", 5, undefined, { color: BREAK_DEFAULT_COLOR });
	write(join(imgs, "actions", "break", "key.png"), png(breakIdle, 72));
	write(join(imgs, "actions", "break", "key@2x.png"), png(breakIdle, 144));

	// Gallery mock-ups: a row of rounded keys on a dark panel. No text, so no font dependency; captions are added in Maker Console.
	const galleryRow = (keys) => {
		const { width, height } = GALLERY;
		const size = Math.min(320, Math.floor((width * 0.8) / keys.length) - 40);
		const gap = 48;
		const total = keys.length * size + (keys.length - 1) * gap;
		const x0 = (width - total) / 2;
		const y = (height - size) / 2;
		const cells = keys
			.map((svg, i) => {
				const x = x0 + i * (size + gap);
				const clip = `k${i}`;
				return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.16}"/></clipPath><g clip-path="url(#${clip})"><svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 144 144">${inner(svg)}</svg></g>`;
			})
			.join("");
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#26262a"/><stop offset="1" stop-color="#0b0b0c"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#bg)"/>${cells}</svg>`;
	};
	const galleries = {
		"1-four-keys": [key("running", 25, 0.62), key("idle", 15), key("idle", 50), key("idle", 5, undefined, { color: BREAK_DEFAULT_COLOR })],
		"2-states": [key("idle", 25), key("running", 18, 0.72), key("paused", 18, 0.72), key("done", 0)],
		"3-colors": [
			{ color: "#ff6347", minutes: 25, ring: 0.62 },
			{ color: "#1e90ff", minutes: 5, ring: 0.4 },
			{ color: "#32cd32", minutes: 15, ring: 0.8 },
			{ color: "#ffd700", minutes: 50, ring: 0.3 },
		].map(({ color, minutes, ring }) => key("running", minutes, ring, { color })),
		"4-fonts": FONT_IDS.map((font) => key("idle", 25, undefined, { font })),
	};
	for (const [name, keys] of Object.entries(galleries)) write(join(galleryDir, `${name}.png`), png(galleryRow(keys), GALLERY.width));
} finally {
	await server.close();
}
