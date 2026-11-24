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
};

type CompletedEvent = Extract<SessionEvent, { type: "completed" }>;

/**
 * Turns `completed` session events into a sound and/or notification, at most once per session id, using
 * the shared settings as they are when the session completes. Every failure is logged and swallowed: an
 * alert never affects the timer.
 */
export class AlertDispatcher {
	/** How long to wait for the shared settings before alerting with the defaults. */
	static readonly SETTINGS_TIMEOUT_MS = 2_000;
	/**
	 * The coordinator's session ids increase within a process, so remembering the latest alerted one dedupes repeats.
	 * Both reset when the plugin restarts: AUS-1884 (restoring sessions) must persist or seed the session id, or
	 * persist a delivery marker, to dedupe across restarts.
	 */
	#lastAlertedSessionId = 0;

	constructor(private readonly ports: AlertPorts) {}

	/** Resolves once every alert for these events has been attempted. Never rejects. */
	async handle(events: readonly SessionEvent[]): Promise<void> {
		const alerts: Promise<void>[] = [];
		for (const event of events) {
			if (event.type !== "completed" || event.sessionId <= this.#lastAlertedSessionId) continue;
			this.#lastAlertedSessionId = event.sessionId;
			alerts.push(this.#alert(event));
		}
		await Promise.all(alerts);
	}

	async #alert(event: CompletedEvent): Promise<void> {
		const { log } = this.ports;
		let settings: AlertSettings | undefined;
		try {
			settings = await withTimeout(this.ports.loadSettings(), AlertDispatcher.SETTINGS_TIMEOUT_MS);
		} catch (err) {
			log.error("Could not read alert settings; using defaults", err);
		}
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
