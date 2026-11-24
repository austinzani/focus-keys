import { execFile } from "node:child_process";

import type { SoundId } from "../core/alerts";
import type { Notifier, SoundPlayer } from "./dispatcher";

/** Runs a program directly (no shell) and settles with its standard output when it exits. */
export type RunFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>;

/** A program was killed because it ran past its time limit. */
export class TimedOutError extends Error {
	override readonly name = "TimedOutError";
}

/**
 * Resolves on exit 0; rejects on a non-zero exit, a failure to start, output beyond Node's default
 * `maxBuffer` (the program is killed), or with TimedOutError after `timeoutMs` (the program is killed).
 */
export const runFile: RunFile = (file, args, timeoutMs) =>
	new Promise((resolve, reject) => {
		execFile(file, [...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
			if (err === null) resolve(String(stdout));
			else if ((err as { code?: unknown }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") reject(new Error(`${file} wrote more output than allowed (${err.message})`));
			else if (err.killed) reject(new TimedOutError(`${file} timed out after ${timeoutMs} ms`));
			else reject(new Error(`${file} failed: ${err.message}${stderr ? ` (${String(stderr).trim()})` : ""}`));
		});
	});

const SOUNDS_DIR = "/System/Library/Sounds";
/** Longest offered sound is about 2 s; this only bounds a stuck player. */
const SOUND_TIMEOUT_MS = 15_000;
const NOTIFY_TIMEOUT_MS = 10_000;

/** Plays a built-in macOS sound with `afplay`, independently of notifications and Focus. Nothing is bundled. */
export class AfplaySoundPlayer implements SoundPlayer {
	constructor(private readonly run: RunFile = runFile) {}

	async play(sound: SoundId): Promise<void> {
		const file = `${SOUNDS_DIR}/${sound[0].toUpperCase()}${sound.slice(1)}.aiff`;
		await this.run("/usr/bin/afplay", [file], SOUND_TIMEOUT_MS);
	}
}

/**
 * Shows a banner with AppleScript's `display notification`, run by `osascript`. macOS attributes it to
 * Script Editor (com.apple.ScriptEditor2), so its permission and Focus allowances are Script Editor's.
 * The text is passed as arguments to the script's run handler, never pasted into script source, so any
 * text is safe. No `sound name` is given: the completion sound is played separately, so it never doubles.
 * macOS gives no error when banners are denied or hidden by Focus; this only rejects if osascript fails.
 */
export class OsascriptNotifier implements Notifier {
	static readonly SCRIPT = ["on run argv", "display notification (item 1 of argv) with title (item 2 of argv)", "end run"];

	constructor(private readonly run: RunFile = runFile) {}

	async notify(title: string, body: string): Promise<void> {
		const lines = OsascriptNotifier.SCRIPT.flatMap((line) => ["-e", line]);
		await this.run("/usr/bin/osascript", [...lines, "--", body, title], NOTIFY_TIMEOUT_MS);
	}
}
