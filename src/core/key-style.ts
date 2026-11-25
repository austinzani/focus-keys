/**
 * A key's look: its color and number font. Style never affects the timer; it only changes how a key is drawn.
 * Font ids name the bundled digit outlines (src/render/glyphs.generated.ts).
 */
export type KeyStyle = {
	color: string;
	ringColor: string;
	font: FontId;
	visualStyle: VisualStyle;
	backgroundColor: string;
	sweepBackground: string;
	sweepNumber: string;
	sweepEnd: string;
};

export const VISUAL_STYLES = ["ring", "sweep-horizontal", "sweep-vertical"] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export const FONT_IDS = ["inter", "nunito", "oswald", "jetbrains-mono", "bitter"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const DEFAULT_FONT: FontId = "inter";
export const DEFAULT_COLOR = "#ff6347";
/** A Break key's color until one is chosen. */
export const BREAK_DEFAULT_COLOR = "#3cc4a8";
/** Every key is drawn on this background. */
export const KEY_BACKGROUND = "#111111";

/** Reads the color and font settings; anything unusable falls back to the default (`defaultColor` for the color). */
export function parseKeyStyle(settings: { color?: unknown; ringColor?: unknown; font?: unknown; visualStyle?: unknown; backgroundColor?: unknown; sweepBackground?: unknown; sweepNumber?: unknown; sweepEnd?: unknown }, defaultColor: string = DEFAULT_COLOR): KeyStyle {
	const visualStyle = VISUAL_STYLES.find((style) => style === settings.visualStyle) ?? "ring";
	// Older sweep keys stored a separate background; preserve it until the key has a shared background.
	const legacyBackground = visualStyle === "ring" ? KEY_BACKGROUND : parseColor(settings.sweepBackground, KEY_BACKGROUND);
	const backgroundColor = parseColor(settings.backgroundColor, legacyBackground);
	const color = parseColor(settings.color, defaultColor);
	const sweepNumber = parseSweepColor(settings.sweepNumber, "#ffffff");
	return {
		color,
		ringColor: parseColor(settings.ringColor, color),
		font: parseFont(settings.font),
		visualStyle,
		backgroundColor,
		sweepBackground: backgroundColor,
		sweepNumber,
		sweepEnd: parseSweepColor(settings.sweepEnd, sweepNumber),
	};
}

/** Accept the white/black values saved by versions with dropdowns as well as color-picker hex values. */
function parseSweepColor(value: unknown, fallback: string): string {
	if (value === "white") return "#ffffff";
	if (value === "black") return "#000000";
	return parseColor(value, fallback);
}

/** Normalize old dropdown values for the color pickers when a key appears. */
export function sweepColorSettings(settings: { sweepNumber?: unknown; sweepEnd?: unknown }): { sweepNumber?: string; sweepEnd?: string } {
	const number = parseSweepColor(settings.sweepNumber, "#ffffff");
	const end = parseSweepColor(settings.sweepEnd, number);
	const fill: { sweepNumber?: string; sweepEnd?: string } = {};
	if (settings.sweepNumber === undefined || settings.sweepNumber === "white" || settings.sweepNumber === "black") fill.sweepNumber = number;
	if (settings.sweepEnd === undefined || settings.sweepEnd === "white" || settings.sweepEnd === "black") fill.sweepEnd = end;
	return fill;
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

/** Move a previously saved sweep background into the shared background setting. */
export function legacySweepBackground(settings: { visualStyle?: unknown; backgroundColor?: unknown; sweepBackground?: unknown }): string | undefined {
	if (settings.visualStyle !== "sweep-horizontal" && settings.visualStyle !== "sweep-vertical") return undefined;
	if (settings.backgroundColor !== undefined || typeof settings.sweepBackground !== "string") return undefined;
	if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(settings.sweepBackground)) return undefined;
	return parseColor(settings.sweepBackground, KEY_BACKGROUND);
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
