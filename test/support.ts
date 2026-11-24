/** Shared test helpers (not a test file). */
import { readFileSync } from "node:fs";

import { type AlertPorts, AlertDispatcher } from "../src/alerts/dispatcher";
import type { AlertSettings, SoundId } from "../src/core/alerts";
import type { StateStorage } from "../src/persistence/store";

/** The Property Inspector (PI) page's HTML source. */
export function piSource(): string {
	return readFileSync(new URL("../com.austinzani.neo-pomodoro.sdPlugin/ui/preset.html", import.meta.url), "utf8");
}

/** The `<option>` values of the Property Inspector select bound to `setting`. */
export function piOptions(setting: string): string[] {
	const html = piSource();
	const select = new RegExp(`<sdpi-select[^>]*setting="${setting}"[^>]*>([\\s\\S]*?)</sdpi-select>`).exec(html);
	return [...(select?.[1] ?? "").matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

type PiSave = { key: string; value: unknown };

/**
 * Runs the Property Inspector's inline script against fake fields and a fake `SDPIComponents` that records
 * every save it is asked to make, split into per-key settings and plugin global settings.
 */
export function runPiScript() {
	const source = /<script>([\s\S]*?)<\/script>/.exec(piSource())?.[1];
	if (source === undefined) throw new Error("no inline <script> in the Property Inspector");
	const fields = new Map<string, EventTarget & { value?: string }>();
	const field = (id: string) => fields.get(id) ?? fields.set(id, new EventTarget()).get(id)!;
	const saved = { settings: [] as PiSave[], global: [] as PiSave[] };
	const delays: unknown[] = [];
	const fakeUse = (into: PiSave[]) => (key: string, _onChange: unknown, delay: unknown) => {
		delays.push(delay);
		return [async () => undefined, (value: unknown) => void into.push({ key, value })];
	};
	const window = new EventTarget();
	const pluginMessages: ((ev: { payload: unknown }) => void)[] = [];
	/** Messages the inspector sent through the Stream Deck client, e.g. `{ event: "sendToPlugin", payload }`. */
	const sent: { event: string; payload: unknown }[] = [];
	const SDPIComponents = {
		useSettings: fakeUse(saved.settings),
		useGlobalSettings: fakeUse(saved.global),
		streamDeckClient: {
			sendToPropertyInspector: { subscribe: (fn: (ev: { payload: unknown }) => void) => void pluginMessages.push(fn) },
			send: async (event: string, payload: unknown) => void sent.push({ event, payload }),
		},
	};
	new Function("document", "window", "SDPIComponents", source)({ getElementById: field }, window, SDPIComponents);
	return {
		saved,
		delays,
		sent,
		/** Types `text` one key at a time; a newline is typed with the Enter key. */
		type(id: string, text: string) {
			const f = field(id);
			for (const ch of text) {
				f.dispatchEvent(Object.assign(new Event("keydown"), { key: ch === "\n" ? "Enter" : ch }));
				f.value = (f.value ?? "") + ch;
				f.dispatchEvent(new Event("input"));
			}
		},
		/** Presses Enter without changing the value, as in a single-line field. */
		enter: (id: string) => field(id).dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" })),
		blur: (id: string) => field(id).dispatchEvent(new Event("focusout")),
		close: () => window.dispatchEvent(new Event("pagehide")),
		/** Delivers a message the plugin sent to the inspector. */
		fromPlugin: (payload: unknown) => pluginMessages.forEach((fn) => fn({ payload })),
		field: (id: string) => field(id) as EventTarget & { value?: string; textContent?: string; hidden?: boolean },
	};
}

/** Records what the alert would have done on the Mac; a part can be made to fail. */
export function fakeAlertPorts(settings: AlertSettings | Error = {}, delivery?: AlertPorts["delivery"]) {
	const played: SoundId[] = [];
	const notified: { title: string; body: string }[] = [];
	const errors: string[] = [];
	const failing = { sound: false, notify: false };
	const dispatcher = new AlertDispatcher({
		loadSettings: () => (settings instanceof Error ? Promise.reject(settings) : Promise.resolve(settings)),
		sound: { play: async (sound) => (failing.sound ? Promise.reject(new Error("afplay exited 1")) : void played.push(sound)) },
		notifier: {
			notify: async (title, body) => (failing.notify ? Promise.reject(new Error("osascript exited 1")) : void notified.push({ title, body })),
		},
		log: { info: () => {}, error: (msg) => void errors.push(msg) },
		delivery,
	});
	return { dispatcher, played, notified, errors, failing };
}

/**
 * Storage in memory; reads, writes and moving the file aside can be made to fail, and writes can be held
 * open. `backups` holds the text of every file moved aside.
 */
export function memoryStorage(initial?: string) {
	const writes: string[] = [];
	const backups: (string | undefined)[] = [];
	let text = initial;
	const gate = { hold: false, fail: false, readFail: false, moveFail: false, release: () => {} };
	const storage: StateStorage = {
		read: async () => {
			if (gate.readFail) throw new Error("EACCES: permission denied, open 'state.json'");
			return text;
		},
		write: async (next) => {
			if (gate.hold) await new Promise<void>((resolve) => (gate.release = resolve));
			if (gate.fail) throw new Error("EACCES: permission denied");
			writes.push(next);
			text = next;
		},
		moveAside: async () => {
			if (gate.moveFail) throw new Error("EACCES: permission denied, rename");
			backups.push(text);
			text = undefined;
			gate.readFail = false;
			return `/saved/state.unsupported-${backups.length}.json`;
		},
	};
	return { storage, writes, backups, gate, text: () => text };
}
