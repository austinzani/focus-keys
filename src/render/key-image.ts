import type { KeyRender } from "../core/coordinator";

/** Key canvas in px; Stream Deck scales it to the device (72 px, 144 px @2x). */
const SIZE = 144;
const CENTER = SIZE / 2;
const RING_RADIUS = 62;
const RING_WIDTH = 8;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const BACKGROUND = "#111111";
const NUMBER_COLOR = "#f5f5f5";
const RING_COLOR = "#ff6347";
/** Muted grey for a paused session's frozen ring. */
const PAUSED_RING_COLOR = "#6e6e6e";
const RING_TRACK = "#2b2b2b";
const FONT_FAMILY = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Draws one key: a large centered whole-minute number on a dark background, plus a ring arc
 * covering the remaining fraction while running, frozen in muted grey while paused. Never shows seconds.
 */
export function renderKeySvg(render: KeyRender): string {
	const text = String(render.minutes);
	const fontSize = text.length >= 3 ? 52 : 72;
	// Baseline offset instead of dominant-baseline, which some SVG renderers ignore.
	const baseline = CENTER + fontSize * 0.35;

	const ring =
		render.state === "running" || render.state === "paused"
			? `<circle cx="${CENTER}" cy="${CENTER}" r="${RING_RADIUS}" fill="none" stroke="${RING_TRACK}" stroke-width="${RING_WIDTH}"/>` +
				`<circle data-role="progress" cx="${CENTER}" cy="${CENTER}" r="${RING_RADIUS}" fill="none" stroke="${render.state === "paused" ? PAUSED_RING_COLOR : RING_COLOR}" stroke-width="${RING_WIDTH}" ` +
				`stroke-dasharray="${fmt(CIRCUMFERENCE * render.ring)} ${fmt(CIRCUMFERENCE)}" transform="rotate(-90 ${CENTER} ${CENTER})"/>`
			: "";

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${BACKGROUND}"/>` +
		ring +
		`<text x="${CENTER}" y="${fmt(baseline)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="600" fill="${NUMBER_COLOR}">${text}</text>` +
		`</svg>`
	);
}

/** Stream Deck's documented form for SVG images passed to setImage. */
export function keyImageDataUrl(render: KeyRender): string {
	return `data:image/svg+xml,${encodeURIComponent(renderKeySvg(render))}`;
}

function fmt(n: number): string {
	return n.toFixed(2);
}
