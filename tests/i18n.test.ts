import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MODULE_URL = new URL("../src/i18n.ts", import.meta.url).href;

async function runLanguage(environment: Record<string, string>, agentDir?: string): Promise<string> {
	const script = [
		`import { configureAgentDir, language } from ${JSON.stringify(MODULE_URL)};`,
		agentDir === undefined ? "" : `configureAgentDir(${JSON.stringify(agentDir)});`,
		"console.log(language());",
	].filter(Boolean).join("\n");
	const childEnvironment: Record<string, string> = { PATH: process.env.PATH ?? "", ...environment };
	const child = Bun.spawn([process.execPath, "-e", script], {
		env: childEnvironment,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [status, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	assert.equal(status, 0);
	return output.trim();
}

test("language resolves explicit environment, locale, then omomp configuration", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "omp-codex-image-gen-i18n-"));
	try {
		assert.equal(
			await runLanguage({ OMOMP_LANG: "EN", LC_ALL: "zh_CN.UTF-8", LC_MESSAGES: "", LANG: "zh_CN.UTF-8" }),
			"en",
		);
		assert.equal(
			await runLanguage({ OMOMP_LANG: "zh", LC_ALL: "en_US.UTF-8", LC_MESSAGES: "", LANG: "en_US.UTF-8" }),
			"zh",
		);
		assert.equal(
			await runLanguage({ LC_ALL: "", LC_MESSAGES: "", LANG: "zh_CN.UTF-8" }),
			"zh",
		);

		await writeFile(join(agentDir, "omomp.yml"), "omomp-lang:\n  language: zh\n");
		assert.equal(
			await runLanguage({ LC_ALL: "", LC_MESSAGES: "", LANG: "en_US.UTF-8" }, agentDir),
			"zh",
		);
	} finally {
		await rm(agentDir, { force: true, recursive: true });
	}
});
