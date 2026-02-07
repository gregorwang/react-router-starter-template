import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BASELINE_PATH = resolve(process.cwd(), "config/strict-libcheck-baseline.txt");
const shouldUpdateBaseline = process.argv.includes("--update-baseline");

function readBaselineSignatures() {
	if (!existsSync(BASELINE_PATH)) return new Set();
	const content = readFileSync(BASELINE_PATH, "utf8");
	return new Set(
		content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#")),
	);
}

function writeBaselineSignatures(signatures) {
	mkdirSync(dirname(BASELINE_PATH), { recursive: true });
	const lines = [
		"# Strict libcheck baseline (normalized TS error signatures)",
		"# Auto-generated via: node scripts/strict-libcheck-check.mjs --update-baseline",
		...signatures,
	];
	writeFileSync(BASELINE_PATH, `${lines.join("\n")}\n`, "utf8");
}

function collectSignatures(output) {
	const signatures = new Set();
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const match = line.match(/error (TS\d+): (.+)$/);
		if (!match) continue;
		const [, code, message] = match;
		signatures.add(`${code}: ${message.trim()}`);
	}
	return [...signatures].sort((a, b) => a.localeCompare(b));
}

function diffSets(current, baseline) {
	const currentSet = new Set(current);
	const baselineSet = new Set(baseline);
	const added = current.filter((item) => !baselineSet.has(item));
	const resolved = baseline.filter((item) => !currentSet.has(item));
	return { added, resolved };
}

const result = spawnSync("npm run typecheck:libcheck", {
	encoding: "utf8",
	maxBuffer: 20 * 1024 * 1024,
	shell: true,
});

const stdout = result.stdout || "";
const stderr = result.stderr || "";
const combinedOutput = `${stdout}\n${stderr}`;

if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

if (result.error) {
	console.error(`\n[strict-libcheck] failed to execute command: ${result.error.message}`);
	process.exit(1);
}

const signatures = collectSignatures(combinedOutput);

if (shouldUpdateBaseline) {
	writeBaselineSignatures(signatures);
	console.log(`\n[strict-libcheck] baseline updated: ${signatures.length} signatures`);
	process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
	console.error(
		"\n[strict-libcheck] baseline file not found. Run:\n  node scripts/strict-libcheck-check.mjs --update-baseline",
	);
	process.exit(1);
}

const baseline = [...readBaselineSignatures()].sort((a, b) => a.localeCompare(b));
const { added, resolved } = diffSets(signatures, baseline);

if (result.status === 0 && signatures.length === 0) {
	console.log("\n[strict-libcheck] no type errors.");
	process.exit(0);
}

if (result.status !== 0 && signatures.length === 0) {
	console.error(
		`\n[strict-libcheck] typecheck:libcheck failed without TS signature output (exit ${result.status ?? 1}).`,
	);
	process.exit(result.status ?? 1);
}

if (added.length > 0) {
	console.error("\n[strict-libcheck] NEW dependency type drift detected:");
	for (const item of added) console.error(`  + ${item}`);
	if (resolved.length > 0) {
		console.error("\n[strict-libcheck] resolved signatures:");
		for (const item of resolved) console.error(`  - ${item}`);
	}
	process.exit(1);
}

console.log(
	`\n[strict-libcheck] baseline matched (${signatures.length} signatures). No new drift.`,
);
if (resolved.length > 0) {
	console.log(
		`[strict-libcheck] ${resolved.length} signatures were resolved; consider refreshing baseline.`,
	);
}

process.exit(0);
