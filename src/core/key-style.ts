/**
 * A key's look: its color and number font. Style never affects the timer; it only changes how a key is drawn.
 * Font ids name the bundled digit outlines (src/render/glyphs.generated.ts).
 */
export type KeyStyle = {
	color: string;
	font: FontId;
	visualStyle: VisualStyle;
	backgroundColor: string;
	sweepBackground: string;
	sweepNumber: "white" | "black";
};

export const VISUAL_STYLES = ["ring", "sweep-horizontal", "sweep-vertical"] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const FONT_IDS = ["inter", "nunito", "oswald", "jetbrains-mono", "bitter"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const DEFAULT_FONT: FontId = "inter";
export const DEFAULT_COLOR = "#ff6347";
export const DEFAULT_SWEEP_BACKGROUND = "#ad422f";
/** A Break key's color until one is chosen. */
export const BREAK_DEFAULT_COLOR = "#3cc4a8";
/** Every key is drawn on this background. */
export const KEY_BACKGROUND = "#111111";
/** A chosen color is lightened until it reaches this WCAG contrast ratio against the key background. */
const MIN_CONTRAST = 4.5;

/** Reads the color and font settings; anything unusable falls back to the default (`defaultColor` for the color). */
export function parseKeyStyle(settings: { color?: unknown; font?: unknown; visualStyle?: unknown; backgroundColor?: unknown; sweepBackground?: unknown; sweepNumber?: unknown }, defaultColor: string = DEFAULT_COLOR): KeyStyle {
	const backgroundColor = parseColor(settings.backgroundColor, KEY_BACKGROUND);
	return {
		color: ensureVisible(parseColor(settings.color, defaultColor), backgroundColor),
		font: parseFont(settings.font),
		visualStyle: VISUAL_STYLES.find((style) => style === settings.visualStyle) ?? "ring",
		backgroundColor,
		sweepBackground: parseColor(settings.sweepBackground, DEFAULT_SWEEP_BACKGROUND),
		sweepNumber: settings.sweepNumber === "black" ? "black" : "white",
	};
}

function parseFont(value: unknown): FontId {
	return FONT_IDS.find((id) => id === value) ?? DEFAULT_FONT;
}

function parseColor(value: unknown, defaultColor: string): string {
	if (typeof value !== "string") return defaultColor;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return defaultColor;
	return hex.toLowerCase();
}

/** Gently adjusts a ring/number color toward black or white until it stands out on its background. */
function ensureVisible(hex: string, background: string): string {
	const rgb = toRgb(hex);
	const bg = toRgb(background);
	const target: Rgb = contrast([255, 255, 255], bg) >= contrast([0, 0, 0], bg) ? [255, 255, 255] : [0, 0, 0];
	// Integer steps so the last one is exactly t = 1 (pure white); adding 0.02 repeatedly would drift past it.
	for (let i = 0; i <= 50; i++) {
		const mixed = mix(rgb, target, i / 50);
		if (contrast(mixed, bg) >= MIN_CONTRAST) return i === 0 ? hex : toHex(mixed);
	}
	return toHex(target);
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
