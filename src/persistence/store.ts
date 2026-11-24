import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { AlertPorts, Log } from "../alerts/dispatcher";
import type { FocusPorts } from "../focus/dispatcher";
import { type CoordinatorSnapshot, MAX_DURATION_MINUTES, type Session } from "../core/coordinator";

/**
 * What the plugin keeps across restarts: the timer's session and the id bookkeeping that keeps alerts
 * and Focus switches from repeating. `lastSessionId` seeds the session counter so ids never repeat;
 * `lastAlertedSessionId` is the newest session whose completion alert was (about to be) delivered;
 * `focusSessionId` is the session whose running work this plugin turned Focus on for (its start shortcut
 * ran, timed out, or was about to run) and hasn't yet ended, or 0 when Focus was left alone.
 */
export type PersistedState = CoordinatorSnapshot & { lastAlertedSessionId: number; focusSessionId: number };

/**
 * Reads and replaces the saved text. `read` resolves undefined when nothing was saved yet. `moveAside`
 * renames the saved file out of the way (kept, not deleted) and resolves where it went.
 */
export interface StateStorage {
	read(): Promise<string | undefined>;
	write(text: string): Promise<void>;
	moveAside(): Promise<string>;
}

/** The store's log: the plugin log plus warnings (the SDK logger in production). */
export type StoreLog = Log & { warn(message: string): void };

const SCHEMA_VERSION = 1;
const EMPTY: PersistedState = { lastSessionId: 0, session: undefined, lastAlertedSessionId: 0, focusSessionId: 0 };

/** Where the state file lives: outside the plugin folder, so it survives plugin updates and reinstalls. */
export function defaultStatePath(): string {
	return join(homedir(), "Library", "Application Support", "com.austinzani.focus-keys", "state.json");
}

/**
 * The persisted state, held in memory and written through to storage on each change. Writes run one at a
 * time; changes made while one is in flight are merged into a single follow-up write of the latest state.
 * Nothing here throws: a failed write is logged and retried with the next change, so storage problems
 * never reach the timer. A file that can't be read or used (corrupt, or from another version) is moved
 * aside, kept for a plugin that can read it, and this run starts clean. If it can't even be moved, it is
 * never written over: the store is read-only for this run, keeping its state in memory only.
 */
export class StateStore {
	#state: PersistedState;
	/** A follow-up write is queued; it writes whatever the state is when it runs. */
	#queued: Promise<boolean> | undefined;
	#writing: Promise<boolean> = Promise.resolve(true);

	private constructor(
		private readonly storage: StateStorage,
		private readonly log: Log,
		state: PersistedState,
		/**
		 * The file couldn't be used or moved aside, so it must be kept as it is: updates stay in memory and
		 * nothing is saved this run (logged once, here at startup).
		 */
		readonly readOnly: boolean,
	) {
		this.#state = state;
	}

	/**
	 * Loads the saved state. A missing file starts clean; one that can't be read or used is moved aside
	 * (with a warning naming where) and this run starts clean; if that fails too, the store is read-only.
	 */
	static async open(storage: StateStorage, log: StoreLog): Promise<StateStore> {
		let problem: string;
		let cause: unknown;
		try {
			const text = await storage.read();
			if (text === undefined) return new StateStore(storage, log, EMPTY, false);
			const parsed = parseState(text, log);
			if (typeof parsed !== "string") return new StateStore(storage, log, parsed, false);
			problem = parsed;
		} catch (err) {
			problem = `can't be read (${errorText(err)})`;
			cause = err;
		}
		try {
			const backup = await storage.moveAside();
			log.warn(`Saved timer state ${problem}; moved it to ${backup} and starting clean`);
			return new StateStore(storage, log, EMPTY, false);
		} catch (err) {
			log.error(
				`Saved timer state ${problem} and couldn't be moved aside (${errorText(err)}); the timer starts idle and won't be saved this run, leaving the file as it is (see docs/USER_GUIDE.md, Troubleshooting)`,
				cause ?? err,
			);
			return new StateStore(storage, log, EMPTY, true);
		}
	}

	/** The alert delivery record for the alert dispatcher, or undefined when nothing can be saved this run. */
	alertDelivery(): AlertPorts["delivery"] {
		if (this.readOnly) return undefined;
		return { lastAlertedSessionId: this.#state.lastAlertedSessionId, markAlerted: (sessionId) => this.update({ lastAlertedSessionId: sessionId }) };
	}

	/** The Focus record for the Focus dispatcher, or undefined when nothing can be saved this run. */
	focusRecord(): FocusPorts["record"] {
		if (this.readOnly) return undefined;
		return { focusSessionId: this.#state.focusSessionId, save: (focusSessionId) => this.update({ focusSessionId }) };
	}

	/** The latest state, including changes still being written. */
	get state(): PersistedState {
		return this.#state;
	}

	/** Changes the state now and saves it. Resolves true once saved, false if the write failed or is not allowed. Never rejects. */
	update(change: Partial<PersistedState>): Promise<boolean> {
		this.#state = { ...this.#state, ...change };
		if (this.readOnly) return Promise.resolve(false);
		if (this.#queued === undefined) {
			const queued = this.#writing.then(() => {
				this.#queued = undefined;
				return this.#write();
			});
			this.#queued = queued;
			this.#writing = queued;
		}
		return this.#queued;
	}

	async #write(): Promise<boolean> {
		try {
			await this.storage.write(serialize(this.#state));
			return true;
		} catch (err) {
			this.log.error("Could not save the timer state", err);
			return false;
		}
	}
}

/**
 * A file written atomically (temporary file, flushed, then renamed over the old one), so a crash never
 * leaves half a file. Reading first removes temporary files a crash left behind (only one plugin process
 * writes, and it reads once at startup, before any write).
 */
export function fileStorage(path: string): StateStorage {
	const dir = dirname(path);
	const name = basename(path);
	return {
		async read() {
			await removeStaleTemporaryFiles(dir, name);
			try {
				return await readFile(path, "utf8");
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw err;
			}
		},
		async write(text) {
			await mkdir(dir, { recursive: true });
			const tmp = `${path}.${randomUUID()}.tmp`;
			try {
				const file = await open(tmp, "w");
				try {
					await file.writeFile(text, "utf8");
					await file.sync();
				} finally {
					await file.close();
				}
				await rename(tmp, path);
			} catch (err) {
				await rm(tmp, { force: true });
				throw err;
			}
			await syncDirectory(dir);
		},
		async moveAside() {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const backup = join(dir, `${name.replace(/\.json$/, "")}.unsupported-${stamp}-${randomUUID().slice(0, 8)}.json`);
			await rename(path, backup);
			return backup;
		},
	};
}

/** Deletes `<name>.*.tmp` files in `dir`; best effort. */
async function removeStaleTemporaryFiles(dir: string, name: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}
	const stale = entries.filter((entry) => entry.startsWith(`${name}.`) && entry.endsWith(".tmp"));
	await Promise.all(stale.map((entry) => rm(join(dir, entry), { force: true }).catch(() => {})));
}

/** Flushes the folder entry so the rename itself survives a power loss; best effort. */
async function syncDirectory(dir: string): Promise<void> {
	try {
		const handle = await open(dir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		// Not every file system allows syncing a folder; the rename has already happened.
	}
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function serialize(state: PersistedState): string {
	return JSON.stringify({ version: SCHEMA_VERSION, ...state });
}

/**
 * Parses saved text field by field: an unusable session is dropped, an unusable id counts as 0. Text that
 * isn't a state file this version writes (corrupt, or another version) resolves to a description of why.
 */
function parseState(text: string, log: Log): PersistedState | string {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return "is not valid JSON";
	}
	if (!isRecord(raw)) return "is not an object";
	if (raw.version !== SCHEMA_VERSION) return `has an unknown format (version ${String(raw.version)})`;
	const session = raw.session === undefined ? undefined : parseSession(raw.session);
	if (raw.session !== undefined && session === undefined) log.error(`Saved timer session is unusable; dropping it: ${JSON.stringify(raw.session)}`);
	return {
		lastSessionId: sessionIdOr0(raw.lastSessionId),
		session,
		lastAlertedSessionId: sessionIdOr0(raw.lastAlertedSessionId),
		focusSessionId: sessionIdOr0(raw.focusSessionId),
	};
}

function parseSession(raw: unknown): Session | undefined {
	if (!isRecord(raw)) return undefined;
	const { id, keyId, durationMs } = raw;
	if (!isSessionId(id) || typeof keyId !== "string" || keyId === "") return undefined;
	if (!Number.isInteger(durationMs) || (durationMs as number) <= 0 || (durationMs as number) > MAX_DURATION_MINUTES * 60_000) return undefined;
	// Only breaks are marked; anything else (including sessions saved before breaks existed) is a focus session.
	const base = { id, keyId, durationMs: durationMs as number, ...(raw.kind === "break" ? { kind: "break" as const } : {}) };
	if (raw.status === "running" && Number.isFinite(raw.endsAt)) return { ...base, status: "running", endsAt: raw.endsAt as number };
	if (raw.status === "paused" && Number.isFinite(raw.remainingMs)) {
		return { ...base, status: "paused", remainingMs: Math.min(Math.max(raw.remainingMs as number, 0), base.durationMs) };
	}
	if (raw.status === "completed") return { ...base, status: "completed" };
	return undefined;
}

function isSessionId(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function sessionIdOr0(value: unknown): number {
	return isSessionId(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
