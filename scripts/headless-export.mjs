// Export .recordly projects to MP4 without showing any window or touching the mouse.
//
// Runs the editor's smoke-export mode (RECORDLY_SMOKE_EXPORT) in a hidden window: the project is
// loaded and rendered exactly as the editor's Export button would (cursor, zoom, background, etc.)
// and the result is written straight to the output path, with no save dialog.
//
// Usage:
//   npm run build:headless            (once, and after changing the app source)
//   node scripts/headless-export.mjs <project>... [options]
//
// <project> is a path to a .recordly file or a project name in --projects-dir ("emp-1-2").
//
// Options:
//   --out-dir <dir>         Where to write <project>.mp4 (default: current directory)
//   --output <file>         Output file (only with a single project)
//   --projects-dir <dir>    Where bare project names are looked up
//                           (default: <appData>/Recordly/recordings/Projects)
//   --fps <24|30|60>        Frame rate (default: 60)
//   --quality <medium|good|high|source>  Resolution; source = original size (default: source)
//   --encoding <fast|balanced|quality>   Encoder preset (default: balanced)
//   --render-backend <webgl|webgpu>      Force a render backend (default: the app's choice)
//   --backend <auto|webcodecs|breeze>    Force an encode backend (default: the app's choice)
//   --timeout-min <n>       Kill an export that runs longer than this (default: 15)
//   --user-data <dir>       Reuse this Recordly profile instead of a fresh temporary one
//   --show                  Show the editor window while exporting (debugging)
//   --keep-logs             Keep <output>.log and <output>.report.json after a successful export
//   --verbose               Print the app's full log instead of its [smoke-export] lines
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(repoRoot, "dist-electron", "main.cjs");
const rendererEntry = path.join(repoRoot, "dist", "index.html");

const VALUE_OPTIONS = new Set([
	"out-dir",
	"output",
	"projects-dir",
	"fps",
	"quality",
	"encoding",
	"render-backend",
	"backend",
	"timeout-min",
	"user-data",
]);
const FLAG_OPTIONS = new Set(["show", "keep-logs", "verbose", "help"]);

function parseArgs(argv) {
	const options = {};
	const projects = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) {
			projects.push(arg);
			continue;
		}
		const name = arg.slice(2);
		if (FLAG_OPTIONS.has(name)) {
			options[name] = true;
		} else if (VALUE_OPTIONS.has(name)) {
			const value = argv[++i];
			if (value === undefined) throw new Error(`--${name} needs a value`);
			options[name] = value;
		} else {
			throw new Error(`Unknown option --${name}`);
		}
	}
	return { options, projects };
}

function pickOne(value, allowed, label, fallback) {
	if (value === undefined) return fallback;
	if (!allowed.includes(value)) {
		throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
	}
	return value;
}

function defaultAppDataDir() {
	if (process.platform === "win32") {
		return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support");
	}
	return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

async function exists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function resolveProjectPath(project, projectsDir) {
	if (
		project.toLowerCase().endsWith(".recordly") ||
		project.includes("/") ||
		project.includes("\\")
	) {
		return path.resolve(project);
	}
	return path.join(projectsDir, `${project}.recordly`);
}

async function readReport(outputPath) {
	try {
		return JSON.parse(await fs.readFile(`${outputPath}.report.json`, "utf8"));
	} catch {
		return null;
	}
}

function formatMs(ms) {
	return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;
}

async function exportProject({ projectPath, outputPath, settings }) {
	const label = path.basename(projectPath, ".recordly");
	const logPath = `${outputPath}.log`;
	const userDataDir =
		settings.userData ?? (await fs.mkdtemp(path.join(os.tmpdir(), "recordly-headless-")));

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.rm(outputPath, { force: true });
	await fs.rm(`${outputPath}.report.json`, { force: true });

	const startedAt = performance.now();
	const child = spawn(electron, [repoRoot], {
		cwd: repoRoot,
		env: {
			...process.env,
			RECORDLY_SMOKE_EXPORT: "1",
			RECORDLY_HEADLESS: settings.show ? "0" : "1",
			RECORDLY_USER_DATA_DIR: userDataDir,
			RECORDLY_SMOKE_EXPORT_PROJECT: projectPath,
			RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
			RECORDLY_SMOKE_EXPORT_FPS: String(settings.fps),
			RECORDLY_SMOKE_EXPORT_QUALITY: settings.quality,
			RECORDLY_SMOKE_EXPORT_ENCODING_MODE: settings.encoding,
			...(settings.renderBackend
				? { RECORDLY_SMOKE_EXPORT_RENDER_BACKEND: settings.renderBackend }
				: {}),
			...(settings.backend ? { RECORDLY_SMOKE_EXPORT_BACKEND: settings.backend } : {}),
		},
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});

	const log = await fs.open(logPath, "w");
	const forward = (chunk, stream) => {
		const text = chunk.toString();
		void log.write(text);
		if (settings.verbose) {
			stream.write(text.replace(/^/gm, `[${label}] `));
			return;
		}
		for (const line of text.split(/\r?\n/)) {
			if (line.includes("[smoke-export]")) stream.write(`[${label}] ${line.trim()}\n`);
		}
	};
	child.stdout.on("data", (chunk) => forward(chunk, process.stdout));
	child.stderr.on("data", (chunk) => forward(chunk, process.stderr));

	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, settings.timeoutMs);
	const [exitCode] = await once(child, "close");
	clearTimeout(timeout);
	await log.close();
	if (!settings.userData) await fs.rm(userDataDir, { recursive: true, force: true });

	const elapsedMs = Math.round(performance.now() - startedAt);
	const report = await readReport(outputPath);
	const size = (await exists(outputPath)) ? (await fs.stat(outputPath)).size : 0;
	const success = !timedOut && report?.success === true && size > 0;

	if (success && !settings.keepLogs) {
		await fs.rm(logPath, { force: true });
		await fs.rm(`${outputPath}.report.json`, { force: true });
	}

	return {
		label,
		success,
		outputPath,
		size,
		elapsedMs,
		error: timedOut
			? `timed out after ${formatMs(settings.timeoutMs)}`
			: success
				? null
				: (report?.error ?? `app exited with code ${exitCode} without a report`),
		logPath,
	};
}

async function main() {
	const { options, projects } = parseArgs(process.argv.slice(2));
	if (options.help || projects.length === 0) {
		const header = (await fs.readFile(fileURLToPath(import.meta.url), "utf8"))
			.split("\n")
			.filter((line) => line.startsWith("//"))
			.map((line) => line.replace(/^\/\/ ?/, ""))
			.join("\n");
		console.log(header);
		process.exit(projects.length === 0 && !options.help ? 1 : 0);
	}

	if (!(await exists(mainEntry)) || !(await exists(rendererEntry))) {
		throw new Error("The app is not built yet. Run `npm run build:headless` first.");
	}
	if (options.output && projects.length > 1) {
		throw new Error("--output works with a single project; use --out-dir for several");
	}

	const settings = {
		fps: Number(pickOne(options.fps, ["24", "30", "60"], "--fps", "60")),
		quality: pickOne(
			options.quality,
			["medium", "good", "high", "source"],
			"--quality",
			"source",
		),
		encoding: pickOne(
			options.encoding,
			["fast", "balanced", "quality"],
			"--encoding",
			"balanced",
		),
		renderBackend: pickOne(options["render-backend"], ["webgl", "webgpu"], "--render-backend"),
		backend: pickOne(options.backend, ["auto", "webcodecs", "breeze"], "--backend"),
		timeoutMs: Math.max(1, Number(options["timeout-min"] ?? 15)) * 60_000,
		userData: options["user-data"] ? path.resolve(options["user-data"]) : null,
		show: options.show === true,
		keepLogs: options["keep-logs"] === true,
		verbose: options.verbose === true,
	};
	const projectsDir = path.resolve(
		options["projects-dir"] ??
			path.join(defaultAppDataDir(), "Recordly", "recordings", "Projects"),
	);
	const outDir = path.resolve(options["out-dir"] ?? process.cwd());

	const results = [];
	for (const project of projects) {
		const projectPath = resolveProjectPath(project, projectsDir);
		if (!(await exists(projectPath))) {
			results.push({
				label: project,
				success: false,
				error: `project not found: ${projectPath}`,
			});
			console.error(`✗ ${project}: project not found (${projectPath})`);
			continue;
		}
		const outputPath = options.output
			? path.resolve(options.output)
			: path.join(outDir, `${path.basename(projectPath, ".recordly")}.mp4`);
		console.log(`→ ${path.basename(projectPath)} → ${outputPath}`);
		const result = await exportProject({ projectPath, outputPath, settings });
		results.push(result);
		if (result.success) {
			console.log(
				`✓ ${result.label}: ${(result.size / 1024 / 1024).toFixed(1)} MB in ${formatMs(result.elapsedMs)}`,
			);
		} else {
			console.error(`✗ ${result.label}: ${result.error} (log: ${result.logPath})`);
		}
	}

	const failed = results.filter((result) => !result.success);
	console.log(`\n${results.length - failed.length}/${results.length} exported`);
	process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
