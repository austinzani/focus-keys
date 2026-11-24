#!/usr/bin/env node
/**
 * Owner-run prototype for AUS-1883: answers what Apple's Shortcuts can do with Focus on this Mac.
 * It CHANGES FOCUS (and Focus syncs to your other Apple devices if "Share across devices" is on).
 * Run it only at the Mac, after creating the four test shortcuts described in README
 * ("Owner prototype: Focus via Shortcuts"). Nothing else on the Mac is changed.
 *
 *   node scripts/focus-prototype.mjs [results-file]
 *
 * Every shortcut run is recorded as one JSON line (step, argv, exit code, stdout, stderr, milliseconds) plus
 * your answers to the prompts, in the results file (default: focus-prototype-<time>.jsonl in the current directory).
 */
import { execFile } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const NAMES = {
	get: "Neo Pomodoro Test - Get Focus",
	on: "Neo Pomodoro Test - Focus On",
	off: "Neo Pomodoro Test - Focus Off",
	setFromInput: "Neo Pomodoro Test - Set Focus From Input",
};
const out = process.argv[2] ?? `focus-prototype-${new Date().toISOString().replaceAll(":", "-")}.jsonl`;
const scratch = mkdtempSync(join(tmpdir(), "neo-focus-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const rl = createInterface({ input: process.stdin, output: process.stdout });

function record(entry) {
	appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/** Runs one shortcut exactly as the plugin would (argv, no shell, timeout) and records the outcome. */
function run(step, name, extra = []) {
	const args = ["run", ...extra, "--", name];
	const started = Date.now();
	return new Promise((resolve) => {
		execFile("/usr/bin/shortcuts", args, { timeout: 30_000 }, (err, stdout, stderr) => {
			const result = { step, argv: args, exit: err ? (err.killed ? "timeout" : err.code) : 0, stdout, stderr, ms: Date.now() - started };
			record(result);
			console.log(`  ${step}: exit=${result.exit} ${result.ms}ms stdout=${JSON.stringify(stdout)}${stderr ? ` stderr=${JSON.stringify(stderr.trim())}` : ""}`);
			resolve(result);
		});
	});
}

async function ask(question) {
	const answer = (await rl.question(`${question}\n> `)).trim();
	record({ step: "owner", question, answer });
	return answer;
}

const getFocus = (step) => run(step, NAMES.get, ["--output-path", "-", "--output-type", "public.plain-text"]);

console.log(`Recording to ${out}\nThis changes Focus on this Mac (and synced devices). Ctrl-C to stop at any time.\n`);
await ask(`Created all four shortcuts (${Object.values(NAMES).join(", ")})? Press Enter to start.`);

// Q1/Q2: what Get Current Focus returns through the command line, for no Focus and for named Focuses.
for (const state of ["NO Focus (turn every Focus off in Control Center)", "Do Not Disturb", "your work Focus", "a third Focus (e.g. Personal or Reading)"]) {
	await ask(`Set ${state} by hand in Control Center, then press Enter.`);
	await getFocus(`get-current: ${state}`);
	await getFocus(`get-current again: ${state}`);
}

// Q3/Q6: switching on and off through the command line; first-run permission prompts.
await ask("Turn every Focus off by hand, then press Enter. Watch for any permission prompt when the next shortcut runs.");
await run("focus-on", NAMES.on);
await getFocus("get-after-on");
await ask("Did the work Focus turn on? Did any permission/privacy prompt appear (what did it say)?");
await run("focus-off", NAMES.off);
await getFocus("get-after-off");
await ask("Did Focus turn off? Any prompt?");

// Q4: restoration: capture the current Focus, switch, then feed the captured value back in. Three rounds each.
for (const state of ["Do Not Disturb", "a third Focus (not your work Focus)", "NO Focus"].flatMap((s) => [s, s, s])) {
	await ask(`Set ${state} by hand, then press Enter.`);
	const before = await getFocus(`restore: capture (${state})`);
	await run(`restore: focus-on (${state})`, NAMES.on);
	const input = join(scratch, "previous-focus.txt");
	writeFileSync(input, before.stdout);
	await run(`restore: set-from-input (${state})`, NAMES.setFromInput, ["--input-path", input]);
	await getFocus(`restore: read back (${state})`);
	await ask(`Is ${state} active again now, exactly as before (same Focus, nothing left on)?`);
}

// Q5: detecting a manual change during a session.
await run("manual: focus-on", NAMES.on);
await ask("Now change Focus by hand to Do Not Disturb (as if you changed it mid-timer), then press Enter.");
await getFocus("manual: read after hand change");
await run("manual: focus-off", NAMES.off);
await ask("Did the Focus Off shortcut turn off the Do Not Disturb you chose by hand? (Set Focus Off may only affect the Focus it names.)");

// Q5b: scheduled changes look the same to the plugin as hand changes; observe one if convenient.
const answer = await ask("Optional: add a Focus schedule (System Settings › Focus › a Focus › Add Schedule) starting 2 minutes from now, wait for it, then press Enter (type 'skip' to skip).");
if (answer.toLowerCase() !== "skip") {
	await getFocus("scheduled: read after schedule began");
	await run("scheduled: focus-off", NAMES.off);
	await ask("Did Focus Off end the scheduled Focus? Remove the test schedule afterwards.");
}

// Q7: does a Focus hide the plugin's completion banner (Script Editor via osascript)?
await run("banner: focus-on", NAMES.on);
await new Promise((resolve) =>
	execFile("/usr/bin/osascript", ["-e", 'display notification "Focus banner test" with title "Neo Pomodoro"'], { timeout: 10_000 }, (err, stdout, stderr) => {
		record({ step: "banner: osascript", exit: err ? (err.killed ? "timeout" : err.code) : 0, stdout, stderr });
		if (err) console.log(`  banner: osascript failed: ${err.message}`);
		resolve();
	}),
);
await ask("With the work Focus on, did a 'Neo Pomodoro — Focus banner test' banner appear? (Script Editor allowed in that Focus?)");
await run("banner: focus-off", NAMES.off);

await ask("Is 'Share across devices' on in System Settings › Focus? Did your iPhone follow these changes?");
console.log(`\nDone. Results: ${out}`);
rl.close();
