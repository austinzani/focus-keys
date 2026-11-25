import { contrastingNumber, DEFAULT_FONT, KEY_BACKGROUND, mix, toHex, toRgb } from "../core/key-style";
import type { KeyRender } from "../core/coordinator";
import { GLYPH_FONTS, type GlyphFont } from "./glyphs.generated";

/** Key canvas in px; Stream Deck scales it to the device (72 px, 144 px @2x). */
const SIZE = 144;
const CENTER = SIZE / 2;
const RING_RADIUS = 62;
const RING_WIDTH = 8;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** The number's ink box stays inside this radius, 4 px within the ring's inner edge so wide numbers don't crowd it. */
const NUMBER_RADIUS = RING_RADIUS - RING_WIDTH / 2 - 4;
/** Digits are never taller than this, in px; wider numbers are sized down to fit inside NUMBER_RADIUS. */
const MAX_DIGIT_HEIGHT = 62;

/** A paused ring is the key color mixed this far toward PAUSED_GREY. */
const PAUSED_MUTE = 0.6;
const PAUSED_GREY = "#5a5a5a";
const RING_TRACK = "#2b2b2b";
/** Last resort only, when no digit outlines are available. */
const FALLBACK_FONT_FAMILY = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Draws one key with a whole-minute number, either a shrinking ring or a growing background sweep.
 * A paused ring is muted; a paused sweep stays frozen. Never shows seconds.
 * Digits are drawn from bundled font outlines, so the look never depends on fonts installed on the Mac.
 */
export function renderKeySvg(render: KeyRender, fonts: Readonly<Record<string, GlyphFont>> = GLYPH_FONTS): string {
	const { color, ringColor: chosenRingColor, visualStyle, backgroundColor, sweepBackground, sweepNumber, sweepEnd } = render.style;
	const isRing = visualStyle === "ring";
	const numberColor = isRing ? color : sweepNumber;
	const ringColor = render.state === "paused" ? toHex(mix(toRgb(chosenRingColor), toRgb(PAUSED_GREY), PAUSED_MUTE)) : chosenRingColor;
	const trackColor = backgroundColor === KEY_BACKGROUND ? RING_TRACK : toHex(mix(toRgb(backgroundColor), toRgb(chosenRingColor), 0.2));

	const ring =
		isRing && (render.state === "running" || render.state === "paused")
			? `<circle cx="${CENTER}" cy="${CENTER}" r="${RING_RADIUS}" fill="none" stroke="${trackColor}" stroke-width="${RING_WIDTH}"/>` +
				`<circle data-role="progress" cx="${CENTER}" cy="${CENTER}" r="${RING_RADIUS}" fill="none" stroke="${ringColor}" stroke-width="${RING_WIDTH}" ` +
				`stroke-dasharray="${fmt(CIRCUMFERENCE * render.ring)} ${fmt(CIRCUMFERENCE)}" transform="rotate(-90 ${CENTER} ${CENTER})"/>`
			: "";

	const text = String(render.minutes);
	// The key's font, else the default font, else plain text: whichever first has every digit needed.
	const font = [fonts[render.style.font], fonts[DEFAULT_FONT]].find((f) => f !== undefined && hasDigits(f, text));
	const number = font !== undefined ? outlinedNumber(text, font, numberColor) : textNumber(text, numberColor);
	let sweep = "";
	if (!isRing) {
		const elapsed = render.state === "done" ? 1 : render.state === "idle" ? 0 : Math.max(0, Math.min(1, 1 - render.ring));
		const width = visualStyle === "sweep-horizontal" ? SIZE * elapsed : SIZE;
		const height = visualStyle === "sweep-vertical" ? SIZE * elapsed : SIZE;
		const inverted = contrastingNumber(sweepEnd);
		const sweepColor = sweepEnd;
		const invertedNumber = font !== undefined ? outlinedNumber(text, font, inverted) : textNumber(text, inverted);
		sweep = `<defs><clipPath id="sweep-clip"><rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}"/></clipPath></defs>` +
			`<rect data-role="sweep" width="${fmt(width)}" height="${fmt(height)}" fill="${sweepColor}"/>` +
			number + `<g clip-path="url(#sweep-clip)">${invertedNumber}</g>`;
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${isRing ? backgroundColor : sweepBackground}"/>` +
		ring +
		(isRing ? number : sweep) +
		`</svg>`
	);
}

/** Stream Deck's documented form for SVG images passed to setImage. */
export function keyImageDataUrl(render: KeyRender): string {
	return `data:image/svg+xml,${encodeURIComponent(renderKeySvg(render))}`;
}

function hasDigits(font: GlyphFont, text: string): boolean {
	return [...text].every((ch) => font.digits[ch] !== undefined);
}

/**
 * Lays the digit outlines side by side, centered on the key by their ink (not advance widths), as large as
 * fits: the ink box's corners touch the NUMBER_RADIUS circle, up to MAX_DIGIT_HEIGHT. Condensed fonts and
 * short numbers therefore come out taller. Idle keys use the same size so the number doesn't jump on start.
 */
function outlinedNumber(text: string, font: GlyphFont, fill: string): string {
	const glyphs = [...text].map((ch) => font.digits[ch]!);
	const pens: number[] = [];
	let pen = 0;
	for (const g of glyphs) {
		pens.push(pen);
		pen += g.advance;
	}
	const inkLeft = glyphs[0]!.xMin;
	const inkRight = pens.at(-1)! + glyphs.at(-1)!.xMax;
	const inkWidth = inkRight - inkLeft;
	const inkHeight = font.top - font.bottom;

	const aspect = inkWidth / inkHeight;
	const height = Math.min(MAX_DIGIT_HEIGHT, (2 * NUMBER_RADIUS) / Math.sqrt(1 + aspect ** 2));
	const scale = height / inkHeight;

	const x = CENTER - ((inkLeft + inkRight) / 2) * scale;
	const baseline = CENTER + ((font.top + font.bottom) / 2) * scale;
	const paths = glyphs.map((g, i) => `<path d="${g.d}"${pens[i] === 0 ? "" : ` transform="translate(${pens[i]} 0)"`}/>`).join("");
	return `<g data-role="number" data-text="${text}" fill="${fill}" transform="translate(${fmt(x)} ${fmt(baseline)}) scale(${scale.toFixed(5)})">${paths}</g>`;
}

/** Plain text in a generic system font stack; only used if a digit has no bundled outline. */
function textNumber(text: string, fill: string): string {
	const fontSize = text.length >= 3 ? 52 : 72;
	// Baseline offset instead of dominant-baseline, which some SVG renderers ignore.
	const baseline = CENTER + fontSize * 0.35;
	return (
		`<g data-role="number" data-text="${text}" fill="${fill}">` +
		`<text x="${CENTER}" y="${fmt(baseline)}" text-anchor="middle" font-family="${FALLBACK_FONT_FAMILY}" font-size="${fontSize}" font-weight="600">${text}</text></g>`
	);
}

function fmt(n: number): string {
	return n.toFixed(2);
}
