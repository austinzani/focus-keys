import { describe, expect, it, vi } from "vitest";

import { AlertDispatcher } from "../src/alerts/dispatcher";

import type { SessionEvent } from "../src/core/coordinator";
import { fakeAlertPorts } from "./support";

const MIN = 60_000;

const completed = (sessionId: number, minutes = 5): SessionEvent => ({ type: "completed", keyId: "key-a", sessionId, durationMs: minutes * MIN });

describe("alert dispatcher", () => {
	it("plays the selected sound once when a session completes", async () => {
		const t = fakeAlertPorts({ sound: "hero" });
		await t.dispatcher.handle([{ type: "started", keyId: "key-a", durationMs: 5 * MIN }, completed(1)]);
		expect(t.played).toEqual(["hero"]);
		expect(t.notified).toEqual([]);
	});

	it("does nothing for transitions other than completion", async () => {
		const t = fakeAlertPorts({ notificationEnabled: true });
		await t.dispatcher.handle([
			{ type: "started", keyId: "key-a", durationMs: 5 * MIN },
			{ type: "paused", keyId: "key-a" },
			{ type: "resumed", keyId: "key-a" },
			{ type: "cancelled", keyId: "key-a" },
			{ type: "replaced", keyId: "key-b", durationMs: 5 * MIN, fromKeyId: "key-a", fromState: "running" },
		]);
		expect(t.played).toEqual([]);
		expect(t.notified).toEqual([]);
	});

	it("alerts at most once per session, even if its completion is reported again", async () => {
		const t = fakeAlertPorts();
		await t.dispatcher.handle([completed(1)]);
		await t.dispatcher.handle([completed(1)]);
		await t.dispatcher.handle([completed(2)]);
		expect(t.played).toEqual(["glass", "glass"]);
	});

	it("shows the notification with the user's text alongside the sound", async () => {
		const t = fakeAlertPorts({ sound: "ping", notificationEnabled: true, notificationText: "Break: {minutes} min done" });
		await t.dispatcher.handle([completed(1, 25)]);
		expect(t.played).toEqual(["ping"]);
		expect(t.notified).toEqual([{ title: "Neo Pomodoro", body: "Break: 25 min done" }]);
	});

	it("stays silent but still notifies when silence is selected", async () => {
		const t = fakeAlertPorts({ sound: "none", notificationEnabled: true });
		await t.dispatcher.handle([completed(1)]);
		expect(t.played).toEqual([]);
		expect(t.notified).toHaveLength(1);
	});

	it("logs a failed notification without affecting the sound or throwing", async () => {
		const t = fakeAlertPorts({ notificationEnabled: true });
		t.failing.notify = true;
		await expect(t.dispatcher.handle([completed(1)])).resolves.toBeUndefined();
		expect(t.played).toEqual(["glass"]);
		expect(t.errors).toHaveLength(1);
	});

	it("still notifies when the sound fails", async () => {
		const t = fakeAlertPorts({ notificationEnabled: true });
		t.failing.sound = true;
		await t.dispatcher.handle([completed(1)]);
		expect(t.notified).toHaveLength(1);
		expect(t.errors).toHaveLength(1);
	});

	it("falls back to the default alert when the shared settings can't be read", async () => {
		const t = fakeAlertPorts(new Error("not connected"));
		await t.dispatcher.handle([completed(1)]);
		expect(t.played).toEqual(["glass"]);
		expect(t.errors).toHaveLength(1);
	});

	it("uses the default alert when the shared settings don't arrive in time", async () => {
		vi.useFakeTimers();
		try {
			const played: string[] = [];
			const errors: string[] = [];
			const dispatcher = new AlertDispatcher({
				loadSettings: () => new Promise(() => {}), // Stream Deck never answers
				sound: { play: async (sound) => void played.push(sound) },
				notifier: { notify: async () => {} },
				log: { info: () => {}, error: (msg) => void errors.push(msg) },
			});
			const done = dispatcher.handle([completed(1)]);
			await vi.advanceTimersByTimeAsync(AlertDispatcher.SETTINGS_TIMEOUT_MS);
			await done;
			expect(played).toEqual(["glass"]);
			expect(errors).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
