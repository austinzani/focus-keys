import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** The user turned off notifications for Focus Keys in System Settings. Not worth falling back over. */
export class NotificationsOffError extends Error {
	override readonly name = "NotificationsOffError";
}

/** The helper is still waiting (most likely for the user to answer macOS's permission prompt). */
export class NotificationPendingError extends Error {
	override readonly name = "NotificationPendingError";
}

/** What HelperNotifier needs from the file system; tests pass fakes. */
export type HelperFiles = {
	exists(path: string): Promise<boolean>;
	/** Resolves the file's text, or undefined if it doesn't exist yet. */
	read(path: string): Promise<string | undefined>;
	remove(path: string): Promise<void>;
	tempPath(): string;
	sleep(ms: number): Promise<void>;
};

export const nodeHelperFiles: HelperFiles = {
	exists: (path) => access(path).then(
		() => true,
		() => false,
	),
	read: (path) => readFile(path, "utf8").catch(() => undefined),
	remove: (path) => rm(path, { force: true }),
	tempPath: () => join(tmpdir(), `focus-keys-notify-${randomUUID()}.txt`),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Shows a banner attributed to "Focus Keys" through the bundled helper app (native/notifier), launched with
 * `open` so macOS treats it as an app with its own entry in System Settings › Notifications. The helper
 * writes its outcome to a result file, polled for up to NOTIFY_TIMEOUT_MS: "ok" resolves; "denied" rejects
 * with NotificationsOffError; no answer yet rejects with NotificationPendingError (the first run waits for
 * the permission prompt); anything else, a missing helper or a failed launch rejects with a plain Error.
 */
export class HelperNotifier implements Notifier {
	static readonly POLL_MS = 100;

	constructor(
		private readonly app: string,
		private readonly run: RunFile = runFile,
		private readonly files: HelperFiles = nodeHelperFiles,
	) {}

	async notify(title: string, body: string): Promise<void> {
		if (!(await this.files.exists(this.app))) throw new Error(`notification helper not found at ${this.app}`);
		const result = this.files.tempPath();
		try {
			// -n: a new instance per banner; -g: don't bring it forward. Returns once launched.
			await this.run("/usr/bin/open", ["-n", "-g", this.app, "--args", "--title", title, "--body", body, "--result", result], NOTIFY_TIMEOUT_MS);
			for (let waited = 0; waited < NOTIFY_TIMEOUT_MS; waited += HelperNotifier.POLL_MS) {
				const text = (await this.files.read(result))?.trim();
				if (text === "ok") return;
				if (text === "denied") throw new NotificationsOffError("Focus Keys notifications are turned off in System Settings › Notifications");
				if (text !== undefined && text !== "") throw new Error(`notification helper: ${text}`);
				await this.files.sleep(HelperNotifier.POLL_MS);
			}
			throw new NotificationPendingError("notification helper is still waiting (permission prompt?)");
		} finally {
			// A helper that answers later writes a file nobody reads; it's in the temp folder and tiny.
			await this.files.remove(result).catch(() => undefined);
		}
	}
}

/**
 * Tries the helper first and falls back to AppleScript (a Script Editor banner) when the helper is missing
 * or fails, so a notification still shows. Not when the user turned Focus Keys notifications off, or the
 * helper is still waiting for the permission prompt: a second banner from Script Editor would be wrong there.
 */
export class FallbackNotifier implements Notifier {
	constructor(
		private readonly primary: Notifier,
		private readonly fallback: Notifier,
		private readonly log: { error(message: string, err?: unknown): void },
	) {}

	async notify(title: string, body: string): Promise<void> {
		try {
			await this.primary.notify(title, body);
		} catch (err) {
			if (err instanceof NotificationsOffError || err instanceof NotificationPendingError) throw err;
			this.log.error("Notification helper failed; showing the banner through Script Editor instead", err);
			await this.fallback.notify(title, body);
		}
	}
}
