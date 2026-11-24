/**
 * A key's look: its color and number font. Style never affects the timer; it only changes how a key is drawn.
 * Font ids name the bundled digit outlines (src/render/glyphs.generated.ts).
 */
export type KeyStyle = { color: string; font: FontId };

export const FONT_IDS = ["inter", "nunito", "oswald", "jetbrains-mono", "bitter"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const DEFAULT_FONT: FontId = "inter";
export const DEFAULT_COLOR = "#ff6347";
/** Every key is drawn on this background. */
export const KEY_BACKGROUND = "#111111";
/** A chosen color is lightened until it reaches this WCAG contrast ratio against the key background. */
const MIN_CONTRAST = 4.5;

/** Reads the color and font settings; anything unusable falls back to the default. */
export function parseKeyStyle(settings: { color?: unknown; font?: unknown }): KeyStyle {
	return { color: parseColor(settings.color), font: parseFont(settings.font) };
}

function parseFont(value: unknown): FontId {
	return FONT_IDS.find((id) => id === value) ?? DEFAULT_FONT;
}

function parseColor(value: unknown): string {
	if (typeof value !== "string") return DEFAULT_COLOR;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return DEFAULT_COLOR;
	return ensureVisible(hex.toLowerCase());
}

/** Mixes a too-dark color toward white in small steps until it stands out on the key background. */
function ensureVisible(hex: string): string {
	const rgb = toRgb(hex);
	// Integer steps so the last one is exactly t = 1 (pure white); adding 0.02 repeatedly would drift past it.
	for (let i = 0; i <= 50; i++) {
		const mixed = mix(rgb, [255, 255, 255], i / 50);
		if (contrast(mixed, toRgb(KEY_BACKGROUND)) >= MIN_CONTRAST) return i === 0 ? hex : toHex(mixed);
	}
	return "#ffffff";
}

export type Rgb = [number, number, number];

export function toRgb(hex: string): Rgb {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

export function toHex(rgb: Rgb): string {
	return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear blend: t = 0 gives a, t = 1 gives b. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
	const [r, g, b] = rgb.map((c) => {
		const s = Math.round(c) / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	}) as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
