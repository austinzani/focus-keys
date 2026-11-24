import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fileStorage, StateStore } from "../src/persistence/store";
import { memoryStorage } from "./support";

const MIN = 60_000;
const RUNNING = { id: 7, keyId: "key-a", durationMs: 25 * MIN, status: "running", endsAt: 2_000_000 } as const;

function log() {
	const errors: string[] = [];
	const warnings: string[] = [];
	return { errors, warnings, log: { info: () => {}, warn: (msg: string) => void warnings.push(msg), error: (msg: string) => void errors.push(msg) } };
}

const CLEAN = { lastSessionId: 0, session: undefined, lastAlertedSessionId: 0, focusSessionId: 0 };

describe("persisted session state", () => {
	it("starts clean when nothing was saved", async () => {
		const store = await StateStore.open(memoryStorage().storage, log().log);
		expect(store.state).toEqual({ lastSessionId: 0, session: undefined, lastAlertedSessionId: 0, focusSessionId: 0 });
	});

	it("reads back what was saved, after a restart", async () => {
		const mem = memoryStorage();
		const first = await StateStore.open(mem.storage, log().log);
		expect(await first.update({ lastSessionId: 7, session: RUNNING })).toBe(true);
		expect(await first.update({ lastAlertedSessionId: 6 })).toBe(true);

		const second = await StateStore.open(mem.storage, log().log);
		expect(second.state).toEqual({ lastSessionId: 7, session: RUNNING, lastAlertedSessionId: 6, focusSessionId: 0 });
	});

	it.each([
		["corrupt JSON", "{not json"],
		["a newer schema version", JSON.stringify({ version: 2, lastSessionId: 3 })],
		["no schema version", JSON.stringify({ lastSessionId: 3 })],
		["something other than an object", "[1,2]"],
	])("moves the file aside, warns where it went, and saves fresh state, given %s", async (_name, text) => {
		const l = log();
		const mem = memoryStorage(text);
		const store = await StateStore.open(mem.storage, l.log);
		expect(store.state).toEqual(CLEAN);
		expect(store.readOnly).toBe(false);
		expect(mem.backups).toEqual([text]);
		expect(l.warnings).toEqual([expect.stringContaining("/saved/state.unsupported-1.json")]);
		expect(l.errors).toEqual([]);
		expect(await store.update({ lastSessionId: 1 })).toBe(true);
		expect(JSON.parse(mem.text()!)).toMatchObject({ version: 1, lastSessionId: 1 });
	});

	it("moves an unreadable file aside and saves fresh state", async () => {
		const l = log();
		const mem = memoryStorage("{}");
		mem.gate.readFail = true;
		const store = await StateStore.open(mem.storage, l.log);
		expect(store.readOnly).toBe(false);
		expect(mem.backups).toHaveLength(1);
		expect(l.warnings).toEqual([expect.stringContaining("/saved/state.unsupported-1.json")]);
		expect(await store.update({ lastSessionId: 1 })).toBe(true);
	});

	it.each([
		["can't be read", (mem: ReturnType<typeof memoryStorage>) => void (mem.gate.readFail = true)],
		["is from a newer version", () => {}],
	])("stays read-only, saying so once, when a file that %s can't be moved aside", async (_name, arrange) => {
		const l = log();
		const text = JSON.stringify({ version: 2, lastSessionId: 3 });
		const mem = memoryStorage(text);
		arrange(mem);
		mem.gate.moveFail = true;
		const store = await StateStore.open(mem.storage, l.log);
		expect(store.readOnly).toBe(true);
		expect(store.state).toEqual(CLEAN);
		expect(l.errors).toEqual([expect.stringMatching(/won't be saved/)]);
		expect(await store.update({ lastSessionId: 1, session: RUNNING })).toBe(false);
		expect(store.state.session).toEqual(RUNNING);
		expect(mem.writes).toEqual([]);
		expect(mem.text()).toBe(text);
		expect(l.errors).toHaveLength(1);
	});

	it("offers alert and Focus records that save, unless it is read-only", async () => {
		const writable = await StateStore.open(memoryStorage().storage, log().log);
		expect(await writable.alertDelivery()?.markAlerted(3)).toBe(true);
		expect(await writable.focusRecord()?.save(3)).toBe(true);
		expect(writable.state).toMatchObject({ lastAlertedSessionId: 3, focusSessionId: 3 });

		const mem = memoryStorage();
		mem.gate.readFail = true;
		mem.gate.moveFail = true;
		const readOnly = await StateStore.open(mem.storage, log().log);
		expect(readOnly.alertDelivery()).toBeUndefined();
		expect(readOnly.focusRecord()).toBeUndefined();
	});

	it("drops an unusable session but keeps the id bookkeeping", async () => {
		const l = log();
		const text = JSON.stringify({ version: 1, lastSessionId: 9, lastAlertedSessionId: 8, focusSessionId: 9, session: { ...RUNNING, durationMs: "soon" } });
		const store = await StateStore.open(memoryStorage(text).storage, l.log);
		expect(store.state).toEqual({ lastSessionId: 9, session: undefined, lastAlertedSessionId: 8, focusSessionId: 9 });
		expect(l.errors).toHaveLength(1);
	});

	it("reads back which session this plugin turned Focus on for", async () => {
		const mem = memoryStorage();
		const first = await StateStore.open(mem.storage, log().log);
		expect(await first.update({ lastSessionId: 7, session: RUNNING, focusSessionId: 7 })).toBe(true);
		const second = await StateStore.open(mem.storage, log().log);
		expect(second.state.focusSessionId).toBe(7);
	});

	it("treats an unusable Focus record as none", async () => {
		const text = JSON.stringify({ version: 1, lastSessionId: 7, lastAlertedSessionId: 6, focusSessionId: "yes" });
		const store = await StateStore.open(memoryStorage(text).storage, log().log);
		expect(store.state.focusSessionId).toBe(0);
	});

	it("restores a paused session, never with more time left than its duration", async () => {
		const paused = { id: 3, keyId: "key-b", durationMs: 5 * MIN, status: "paused", remainingMs: 9 * MIN };
		const store = await StateStore.open(memoryStorage(JSON.stringify({ version: 1, lastSessionId: 3, lastAlertedSessionId: 0, session: paused })).storage, log().log);
		expect(store.state.session).toEqual({ ...paused, remainingMs: 5 * MIN });
	});

	it("writes one change at a time, and only the latest of those that piled up behind it", async () => {
		const mem = memoryStorage();
		const store = await StateStore.open(mem.storage, log().log);
		mem.gate.hold = true;
		const first = store.update({ lastSessionId: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0)); // the first write is now in flight
		const queued = [store.update({ lastSessionId: 2 }), store.update({ lastSessionId: 3 }), store.update({ lastAlertedSessionId: 3 })];
		mem.gate.hold = false;
		mem.gate.release();
		expect(await Promise.all([first, ...queued])).toEqual([true, true, true, true]);
		expect(mem.writes.map((w) => JSON.parse(w))).toEqual([
			{ version: 1, lastSessionId: 1, lastAlertedSessionId: 0, focusSessionId: 0 },
			{ version: 1, lastSessionId: 3, lastAlertedSessionId: 3, focusSessionId: 0 },
		]);
	});

	it("logs a failed write without losing the state in memory, and writes it with the next change", async () => {
		const mem = memoryStorage();
		const l = log();
		const store = await StateStore.open(mem.storage, l.log);
		mem.gate.fail = true;
		expect(await store.update({ lastSessionId: 4, session: RUNNING })).toBe(false);
		expect(store.state.session).toEqual(RUNNING);
		expect(l.errors).toHaveLength(1);

		mem.gate.fail = false;
		expect(await store.update({ lastAlertedSessionId: 2 })).toBe(true);
		expect(JSON.parse(mem.text()!)).toEqual({ version: 1, lastSessionId: 4, session: RUNNING, lastAlertedSessionId: 2, focusSessionId: 0 });
	});
});

describe("state file", () => {
	let dir: string | undefined;
	afterEach(() => dir !== undefined && rmSync(dir, { recursive: true, force: true }));

	it("reads nothing before the first write, then replaces the file whole, creating its folder", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		const path = join(dir, "Application Support", "state.json");
		const file = fileStorage(path);
		expect(await file.read()).toBeUndefined();

		await file.write('{"a":1}');
		await file.write('{"b":2}');
		expect(readFileSync(path, "utf8")).toBe('{"b":2}');
		expect(readdirSync(join(dir, "Application Support"))).toEqual(["state.json"]);
		expect(await file.read()).toBe('{"b":2}');
	});

	it("reports a read error other than a missing file", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		await expect(fileStorage(dir).read()).rejects.toThrow(); // the path is a folder: EISDIR
	});

	it("moves the file aside next to it, under a new name each time", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		const path = join(dir, "state.json");
		const file = fileStorage(path);
		writeFileSync(path, "v2");
		const first = await file.moveAside();
		writeFileSync(path, "v3");
		const second = await file.moveAside();
		expect(first).not.toBe(second);
		for (const backup of [first, second]) expect(backup).toMatch(new RegExp(`^${dir}/state\\.unsupported-[^/]+\\.json$`));
		expect(readFileSync(first, "utf8")).toBe("v2");
		expect(readFileSync(second, "utf8")).toBe("v3");
		expect(await file.read()).toBeUndefined();
	});

	it("moves aside a path it can't read as a file", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		const path = join(dir, "state.json");
		mkdirSync(path);
		const l = log();
		const store = await StateStore.open(fileStorage(path), l.log);
		expect(store.readOnly).toBe(false);
		expect(await store.update({ lastSessionId: 1 })).toBe(true);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1, lastSessionId: 1 });
	});

	it("stays read-only when the folder won't let the file be moved", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		const path = join(dir, "state.json");
		writeFileSync(path, JSON.stringify({ version: 2 }));
		chmodSync(dir, 0o500);
		try {
			const store = await StateStore.open(fileStorage(path), log().log);
			expect(store.readOnly).toBe(true);
		} finally {
			chmodSync(dir, 0o700);
		}
		expect(readdirSync(dir)).toEqual(["state.json"]);
	});

	it("removes temporary files left by an interrupted write when it reads", async () => {
		dir = mkdtempSync(join(tmpdir(), "focus-keys-"));
		const path = join(dir, "state.json");
		writeFileSync(path, "{}");
		writeFileSync(`${path}.0b8f-dead.tmp`, "half");
		writeFileSync(join(dir, "other.tmp"), "not ours");
		expect(await fileStorage(path).read()).toBe("{}");
		expect(readdirSync(dir).sort()).toEqual(["other.tmp", "state.json"]);
	});
});
