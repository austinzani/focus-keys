import { execFile } from "node:child_process";

import type { SoundId } from "../core/alerts";
import type { Notifier, SoundPlayer } from "./dispatcher";

/** Runs a program directly (no shell) and settles when it exits. */
export type RunFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<void>;

/** Resolves on exit 0; rejects on a non-zero exit, a failure to start, or after `timeoutMs` (the program is killed). */
export const runFile: RunFile = (file, args, timeoutMs) =>
	new Promise((resolve, reject) => {
		execFile(file, [...args], { timeout: timeoutMs }, (err, _stdout, stderr) => {
			if (err === null) resolve();
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

	play(sound: SoundId): Promise<void> {
		const file = `${SOUNDS_DIR}/${sound[0].toUpperCase()}${sound.slice(1)}.aiff`;
		return this.run("/usr/bin/afplay", [file], SOUND_TIMEOUT_MS);
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

	notify(title: string, body: string): Promise<void> {
		const lines = OsascriptNotifier.SCRIPT.flatMap((line) => ["-e", line]);
		return this.run("/usr/bin/osascript", [...lines, "--", body, title], NOTIFY_TIMEOUT_MS);
	}
}
