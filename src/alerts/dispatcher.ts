import { type AlertSettings, parseAlertPrefs, planAlert, type SoundId } from "../core/alerts";
import type { SessionEvent } from "../core/coordinator";

/** Plays one of the offered sounds. Rejects if playback could not start or failed. */
export interface SoundPlayer {
	play(sound: SoundId): Promise<void>;
}

/** Shows a silent notification banner. Rejects if the request failed; a hidden or denied banner may still resolve. */
export interface Notifier {
	notify(title: string, body: string): Promise<void>;
}

/** The plugin log (the SDK logger in production). */
export interface Log {
	info(message: string): void;
	error(message: string, err?: unknown): void;
}

export type AlertPorts = {
	/** Reads the shared alert settings (plugin global settings) at the moment of completion. */
	loadSettings(): Promise<AlertSettings | undefined>;
	sound: SoundPlayer;
	notifier: Notifier;
	log: Log;
	/**
	 * Delivery bookkeeping saved across restarts: the newest session already alerted, and how to record a
	 * new one. `markAlerted` resolves true once the record is saved, false if saving failed; it is awaited
	 * (up to SAVE_TIMEOUT_MS) before alerting.
	 */
	delivery?: { lastAlertedSessionId: number; markAlerted(sessionId: number): Promise<boolean> };
};

type CompletedEvent = Extract<SessionEvent, { type: "completed" }>;

/**
 * Turns `completed` session events into a sound and/or notification, at most once per session id, using
 * the shared settings as they are when the session completes. Every failure is logged and swallowed: an
 * alert never affects the timer.
 *
 * At most once across restarts too: the delivery is saved (`delivery.markAlerted`) before the sound or
 * notification starts, so a crash or quit mid-alert loses that alert rather than repeating it. If the save
 * fails or takes over SAVE_TIMEOUT_MS the alert still plays; only a crash before the save lands could then repeat it.
 */
export class AlertDispatcher {
	/** How long to wait for the shared settings before alerting with the defaults. */
	static readonly SETTINGS_TIMEOUT_MS = 2_000;
	/** How long an alert waits for its delivery to be saved before playing anyway. */
	static readonly SAVE_TIMEOUT_MS = 2_000;
	/**
	 * The coordinator's session ids only increase (it is seeded from the saved state after a restart), so
	 * remembering the latest alerted one dedupes repeats; it starts from the saved delivery record.
	 */
	#lastAlertedSessionId: number;

	constructor(private readonly ports: AlertPorts) {
		this.#lastAlertedSessionId = ports.delivery?.lastAlertedSessionId ?? 0;
	}

	/** Resolves once every alert for these events has been attempted. Never rejects. */
	async handle(events: readonly SessionEvent[]): Promise<void> {
		const alerts: Promise<void>[] = [];
		for (const event of events) {
			if (event.type !== "completed" || event.sessionId <= this.#lastAlertedSessionId) continue;
			this.#lastAlertedSessionId = event.sessionId;
			alerts.push(this.#alert(event, this.#markAlerted(event.sessionId)));
		}
		await Promise.all(alerts);
	}

	/** Saves the delivery; settles (never rejects) once saved, failed or timed out. */
	async #markAlerted(sessionId: number): Promise<void> {
		try {
			const delivery = this.ports.delivery;
			if (delivery === undefined) return;
			const saved = await withTimeout(delivery.markAlerted(sessionId), AlertDispatcher.SAVE_TIMEOUT_MS);
			if (!saved) this.ports.log.error(`Could not save the alert for session ${sessionId} as delivered; alerting anyway`);
		} catch (err) {
			this.ports.log.error(`Could not save the alert for session ${sessionId} as delivered; alerting anyway`, err);
		}
	}

	async #alert(event: CompletedEvent, marked: Promise<void>): Promise<void> {
		const { log } = this.ports;
		let settings: AlertSettings | undefined;
		try {
			settings = await withTimeout(this.ports.loadSettings(), AlertDispatcher.SETTINGS_TIMEOUT_MS);
		} catch (err) {
			log.error("Could not read alert settings; using defaults", err);
		}
		await marked;
		const plan = planAlert(parseAlertPrefs(settings), event.durationMs);
		log.info(`alert session=${event.sessionId} sound=${plan.sound ?? "none"} notification=${plan.notification !== undefined}`);
		await Promise.all([
			plan.sound === undefined ? undefined : this.ports.sound.play(plan.sound).catch((err: unknown) => log.error("Completion sound failed", err)),
			plan.notification === undefined
				? undefined
				: this.ports.notifier
						.notify(plan.notification.title, plan.notification.body)
						.catch((err: unknown) => log.error("Completion notification failed", err)),
		]);
	}
}

/** Settles like `promise`, or rejects after `ms` if it hasn't settled by then. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
