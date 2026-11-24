import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

// The Stream Deck CLI writes regular files as 0644, including nested app executables.
// Replace that one entry with zip so its original executable mode survives installation.
export function restoreExecutableInArchive(archive, root, entry) {
	if ((statSync(join(root, entry)).mode & 0o111) !== 0o111) {
		throw new Error(`helper is not executable: ${entry}`);
	}
	execFileSync("zip", ["-q", "-d", archive, entry], { cwd: root });
	execFileSync("zip", ["-q", "-X", archive, entry], { cwd: root });
}
