import { type RunFile, runFile, TimedOutError } from "../alerts/macos";
import { type ShortcutRunner, ShortcutTimeoutError } from "./dispatcher";

const SHORTCUTS = "/usr/bin/shortcuts";

/**
 * The user's shortcuts, through Apple's supported `shortcuts` command (macOS 12+). The plugin never reads
 * or changes Focus itself; the user's shortcut does that with the Shortcuts app's "Set Focus" action.
 * `shortcuts run` exits 0 on success and 1 on error (including a missing shortcut); a shortcut that asks
 * for input would wait for it, which the timeout bounds (rejecting with ShortcutTimeoutError).
 */
export class ShortcutsCli implements ShortcutRunner {
	/** Setting a Focus takes well under a second; this only bounds a shortcut stuck waiting for input. */
	static readonly RUN_TIMEOUT_MS = 30_000;
	static readonly LIST_TIMEOUT_MS = 10_000;

	constructor(private readonly exec: RunFile = runFile) {}

	/** Runs the shortcut named `name`. `--` keeps a name that starts with `-` from being read as an option. */
	async run(name: string): Promise<void> {
		try {
			await this.exec(SHORTCUTS, ["run", "--", name], ShortcutsCli.RUN_TIMEOUT_MS);
		} catch (err) {
			if (err instanceof TimedOutError) {
				throw new ShortcutTimeoutError(`Shortcut "${name}" didn't finish within ${ShortcutsCli.RUN_TIMEOUT_MS / 1000} seconds and was stopped; it may have changed Focus already`);
			}
			throw new Error(explain(name, err));
		}
	}

	/** The names of the user's shortcuts, sorted. */
	async list(): Promise<string[]> {
		const out = await this.exec(SHORTCUTS, ["list"], ShortcutsCli.LIST_TIMEOUT_MS);
		const names = out.split("\n").map((line) => line.trim());
		return [...new Set(names.filter((name) => name !== ""))].sort((a, b) => a.localeCompare(b));
	}
}

function explain(name: string, err: unknown): string {
	const detail = err instanceof Error ? err.message : String(err);
	if (detail.includes("ENOENT")) return `The shortcuts command isn't available on this Mac (${detail})`;
	if (/couldn.t find shortcut/i.test(detail)) return `No shortcut named "${name}" in the Shortcuts app; choose another in the Focus settings`;
	return `Shortcut "${name}" failed: ${detail}`;
}
