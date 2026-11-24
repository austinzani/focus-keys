import { type FocusSettings, parseFocusPrefs } from "../core/focus";

/** What the Property Inspector's Focus section shows: the latest problem, or "" for none. */
export type FocusStatusMessage = { event: "focusStatus"; message: string };

/**
 * The "last Focus problem" line in the Property Inspector. It shows the latest failure until a shortcut
 * runs successfully or the Focus settings change (the user may have fixed the cause). Changes to other
 * shared settings, such as the notification text, leave it alone.
 */
export class FocusStatus {
	#problem = "";
	/** The Focus settings last seen, to tell a Focus change from another shared-settings change. */
	#prefs: string | undefined;

	/** `publish` sends the line to the open Property Inspector, if any. */
	constructor(private readonly publish: (status: FocusStatusMessage) => void) {}

	get current(): FocusStatusMessage {
		return { event: "focusStatus", message: this.#problem };
	}

	failed(message: string): void {
		this.#problem = message;
		this.publish(this.current);
	}

	/** A Focus shortcut ran, so the last problem no longer applies. */
	succeeded(): void {
		this.#clear();
	}

	#clear(): void {
		if (this.#problem === "") return;
		this.#problem = "";
		this.publish(this.current);
	}

	/** Remembers the shared settings as they are now, to compare later changes with. */
	settingsSeen(settings: FocusSettings | undefined): void {
		this.#prefs = JSON.stringify(parseFocusPrefs(settings));
	}

	/** The shared settings were changed in the Property Inspector; clears the line if the Focus part changed. */
	settingsChanged(settings: FocusSettings | undefined): void {
		const before = this.#prefs;
		this.settingsSeen(settings);
		if (before !== this.#prefs) this.#clear();
	}

	/** The reply to the inspector's `{ event: "focusStatus" }` request when it loads; undefined for any other message. */
	answer(request: unknown): FocusStatusMessage | undefined {
		const event = typeof request === "object" && request !== null ? (request as { event?: unknown }).event : undefined;
		return event === "focusStatus" ? this.current : undefined;
	}
}
