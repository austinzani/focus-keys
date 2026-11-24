import { type Log, withTimeout } from "../alerts/dispatcher";
import type { SessionEvent } from "../core/coordinator";
import { type FocusPrefs, type FocusSettings, focusIntent, parseFocusPrefs } from "../core/focus";

/**
 * Runs one of the user's shortcuts by name. Rejects if it could not be found, failed, or timed out; a
 * timeout rejects with ShortcutTimeoutError, because the shortcut was stopped partway and may have done its work.
 */
export interface ShortcutRunner {
	run(name: string): Promise<void>;
}

/** A shortcut stopped after its time limit. Unlike other failures, it may already have changed Focus. */
export class ShortcutTimeoutError extends Error {
	override readonly name = "ShortcutTimeoutError";
}

export type FocusPorts = {
	/** Reads the shared Focus settings (plugin global settings) at the moment of each transition. */
	loadSettings(): Promise<FocusSettings | undefined>;
	shortcuts: ShortcutRunner;
	/** Tells the user a Focus shortcut failed or the settings couldn't be read (the key shows an alert); the timer is unaffected. */
	reportFailure(keyId: string, message: string): void;
	/** A Focus shortcut ran successfully, so an earlier failure no longer applies. */
	reportSuccess(): void;
	log: Log;
	/**
	 * The Focus record saved across restarts: the session whose running work this plugin turned Focus on
	 * for (0 for none), and how to save a new value. `save` resolves true once saved, false if saving
	 * failed; it is awaited (up to SAVE_TIMEOUT_MS) before each shortcut runs.
	 */
	record?: { focusSessionId: number; save(focusSessionId: number): Promise<boolean> };
};

type Transition = { intent: "start" | "end"; keyId: string; sessionId: number };

/**
 * Runs the user's Focus shortcuts at focus-session boundaries: the start shortcut when work starts or
 * resumes, the end shortcut (if one is chosen) when it pauses, is cancelled or completes. Transitions run
 * one at a time in the order they happened, so a slow start shortcut is always followed by its end, never
 * overtaken. While one runs, only the latest transition waits behind it: a newer one replaces a waiting one
 * that hasn't started, because Focus only needs to end up matching the timer. So rapid pauses and resumes
 * behind a stuck shortcut add at most one more run, and a waiting start that a later end replaces never
 * runs. Each focus session runs start at most once and end at most once: end only follows a start this
 * plugin ran (successfully, or until it timed out), so it never turns off a Focus the timer didn't turn
 * on, and a replacement during running work changes nothing. Events are deduplicated by session id: late events from an older session and replayed
 * starts or finishes are ignored, so redelivery (AUS-1884 recovery) can't switch Focus again. With Focus
 * switching off, nothing runs. Failures are reported and swallowed: Focus never affects the timer.
 *
 * Across restarts (AUS-1884): which session Focus was turned on for is saved (`record`) before the start
 * shortcut runs and cleared before the end shortcut runs, so a crash mid-shortcut never repeats it (a
 * start interrupted that way counts as maybe ran, like a timeout, and its end still runs). Seeded from the
 * record, a restored running session doesn't start Focus again and its end runs once; `endLeftover` ends a
 * focus session whose work stopped while the plugin was stopped.
 */
export class FocusDispatcher {
	/** How long to wait for the shared settings before skipping a transition. */
	static readonly SETTINGS_TIMEOUT_MS = 2_000;
	/** How long a shortcut waits for the Focus record to be saved before running anyway. */
	static readonly SAVE_TIMEOUT_MS = 2_000;
	/** Whether this plugin ran the start shortcut for the current focus session (and has not yet ended it). */
	#started = false;
	/** The newest session seen; events from older sessions arrive late and are ignored. */
	#sessionId = 0;
	/** Whether the newest session has begun (started/replaced) or finished (cancelled/completed): each happens once. */
	#begun = false;
	#finished = false;
	/** The settings as last read, used to end a focus session if they can't be read at its end. */
	#lastPrefs: FocusPrefs | undefined;
	/** The transition waiting for the running one; a newer one replaces it. */
	#waiting: Transition | undefined;
	/** Settles once nothing is running or waiting; undefined while idle. */
	#draining: Promise<void> | undefined;

	/** The Focus record as last saved (or loaded), so unchanged values aren't saved again. */
	#recorded: number;

	constructor(private readonly ports: FocusPorts) {
		this.#recorded = ports.record?.focusSessionId ?? 0;
		if (this.#recorded > 0) {
			// Focus is still on from before a restart; that session already began, so a replayed start is ignored.
			this.#started = this.#begun = true;
			this.#sessionId = this.#recorded;
		}
	}

	/**
	 * After a restart, once the restored session has caught up with the clock: if this plugin had turned
	 * Focus on and that work is no longer running (it ended, or was paused or cancelled just before a
	 * crash), runs the end transition, once. Call only when no focus session is running (none, or a break). Never rejects.
	 */
	endLeftover(keyId: string): Promise<void> {
		if (this.#started && !this.#finished) this.#enqueue({ intent: "end", keyId, sessionId: this.#sessionId });
		return this.#draining ?? Promise.resolve();
	}

	/** Queues the Focus changes for these events. Resolves once they (and everything queued before) are done. Never rejects. */
	handle(events: readonly SessionEvent[]): Promise<void> {
		for (const event of events) {
			const intent = this.#accept(event);
			if (intent !== undefined) this.#enqueue({ intent, keyId: event.keyId, sessionId: event.sessionId });
		}
		return this.#draining ?? Promise.resolve();
	}

	#enqueue(transition: Transition): void {
		this.#waiting = transition;
		// When idle, the transition starts right away; later ones wait behind it.
		this.#draining ??= this.#drain();
	}

	/** What a new event wants from Focus, or undefined for a late or replayed event. Bookkeeping only. */
	#accept(event: SessionEvent): "start" | "end" | undefined {
		if (event.sessionId < this.#sessionId) return undefined;
		if (event.sessionId > this.#sessionId) {
			this.#sessionId = event.sessionId;
			this.#begun = this.#finished = false;
		}
		// Replays: a session begins once and finishes once, and nothing follows its finish.
		if (this.#finished || ((event.type === "started" || event.type === "replaced") && this.#begun)) return undefined;
		if (event.type === "started" || event.type === "replaced") this.#begun = true;
		if (event.type === "cancelled" || event.type === "completed") this.#finished = true;
		return focusIntent(event);
	}

	async #drain(): Promise<void> {
		while (this.#waiting !== undefined) {
			const next = this.#waiting;
			this.#waiting = undefined;
			try {
				await this.#transition(next);
			} catch (err) {
				this.#logUnexpected(err);
			}
		}
		this.#draining = undefined;
	}

	async #transition({ intent, keyId, sessionId }: Transition): Promise<void> {
		// A replacement of running work, an event delivered twice, or a start or end whose opposite was
		// replaced while waiting, finds the focus session already in this state. A replacement keeps Focus
		// on for the new session, so the record moves to it.
		if (intent === "start" && this.#started) return this.#record(sessionId);
		if (intent === "end" && !this.#started) return;
		let prefs: FocusPrefs | undefined;
		try {
			prefs = this.#lastPrefs = parseFocusPrefs(await withTimeout(this.ports.loadSettings(), FocusDispatcher.SETTINGS_TIMEOUT_MS));
		} catch (err) {
			// Don't start without knowing switching is on; end a focus session this plugin started as last configured.
			this.ports.log.error(`Could not read Focus settings for the ${intent} transition`, err);
			if (intent === "end") prefs = this.#lastPrefs;
			if (prefs === undefined) {
				// Tell the user, unless switching was off when the settings were last read (they likely don't use it).
				if (this.#lastPrefs?.enabled !== false) this.ports.reportFailure(keyId, "Couldn't read the Focus settings; Focus not changed");
				return;
			}
		}
		if (intent === "start") {
			if (!prefs.enabled || prefs.startShortcut === "") return;
			// Saved first: if the plugin dies mid-shortcut, Focus may be on, so a restart still ends it.
			await this.#record(sessionId);
			this.#started = (await this.#run(keyId, prefs.startShortcut)) !== "failed";
			if (!this.#started) await this.#record(0);
		} else {
			this.#started = false;
			// Saved first: if the plugin dies mid-shortcut, a restart doesn't end Focus a second time.
			await this.#record(0);
			if (!prefs.enabled) this.ports.log.info("Focus switching is off; leaving Focus as it is");
			else if (prefs.endShortcut === "") this.ports.log.info("No end Focus shortcut chosen; leaving Focus as it is");
			else await this.#run(keyId, prefs.endShortcut);
		}
	}

	/** Saves the Focus record if it changed; settles (never rejects) once saved, failed or timed out. */
	async #record(focusSessionId: number): Promise<void> {
		const record = this.ports.record;
		if (record === undefined || focusSessionId === this.#recorded) return;
		this.#recorded = focusSessionId;
		try {
			if (!(await withTimeout(record.save(focusSessionId), FocusDispatcher.SAVE_TIMEOUT_MS))) {
				this.ports.log.error(`Could not save the Focus record (${focusSessionId}); switching Focus anyway`);
			}
		} catch (err) {
			this.ports.log.error(`Could not save the Focus record (${focusSessionId}); switching Focus anyway`, err);
		}
	}

	/** A transition threw (a port failed); log it if the log works, so the queue keeps going. */
	#logUnexpected(err: unknown): void {
		try {
			this.ports.log.error("Focus transition failed", err);
		} catch {
			// Nothing left to tell.
		}
	}

	/**
	 * Runs a shortcut, reporting any failure. A timed-out shortcut "maybe ran": it was stopped partway and may
	 * already have set Focus, so a timed-out start still counts as started and its end runs. Any other
	 * failure (missing shortcut, error, permission) means it didn't run.
	 */
	async #run(keyId: string, name: string): Promise<"ran" | "maybe ran" | "failed"> {
		try {
			await this.ports.shortcuts.run(name);
			this.ports.reportSuccess();
			return "ran";
		} catch (err) {
			this.ports.log.error(`Focus shortcut "${name}" failed`, err);
			this.ports.reportFailure(keyId, err instanceof Error ? err.message : String(err));
			return err instanceof ShortcutTimeoutError ? "maybe ran" : "failed";
		}
	}
}
