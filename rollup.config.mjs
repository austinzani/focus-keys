import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.austinzani.neo-pomodoro.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			// MIT and similar licenses require their notices to travel with the bundled code; terser strips them.
			name: "emit-third-party-licenses",
			generateBundle(_options, bundle) {
				const dirs = new Set();
				for (const chunk of Object.values(bundle)) {
					if (chunk.type !== "chunk") continue;
					for (const id of Object.keys(chunk.modules)) {
						const match = /^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/^\0/, ""));
						if (match) dirs.add(match[1]);
					}
				}
				const sections = [...dirs].sort().map((dir) => {
					const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
					const licenseFile = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
					const text = licenseFile ? readFileSync(path.join(dir, licenseFile), "utf8").trim() : `License: ${pkg.license}`;
					return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}`;
				});
				const source = `Third-party code bundled into plugin.js\n\n${sections.join("\n\n" + "-".repeat(72) + "\n\n")}\n`;
				this.emitFile({ fileName: "THIRD_PARTY_LICENSES.txt", source, type: "asset" });
			}
		},
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
