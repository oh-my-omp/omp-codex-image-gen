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

test("language resolves explicit environment, omomp configuration, then locale", async () => {
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

test("configuration requires an exact language enum and rejects unknown section keys", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "omp-codex-image-gen-config-"));
	const cases: readonly { section: unknown; expected: string }[] = [
		{ section: { language: "zh" }, expected: "zh" },
		{ section: { language: "ZH" }, expected: "en" },
		{ section: { language: " zh " }, expected: "en" },
		{ section: { language: "zh", extra: true }, expected: "en" },
		{ section: { language: "zh-CN" }, expected: "en" },
		{ section: { language: 1 }, expected: "en" },
		{ section: {}, expected: "en" },
		{ section: ["zh"], expected: "en" },
		{ section: null, expected: "en" },
	];
	try {
		for (const { section, expected } of cases) {
			await writeFile(join(agentDir, "omomp.json"), JSON.stringify({ "omomp-lang": section }));
			assert.equal(await runLanguage({ LANG: "en_US.UTF-8" }, agentDir), expected, JSON.stringify(section));
		}
	} finally {
		await rm(agentDir, { force: true, recursive: true });
	}
});

test("multiple agent config files are ignored rather than selected in order", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "omp-codex-image-gen-ambiguous-"));
	try {
		await writeFile(join(agentDir, "omomp.yml"), "omomp-lang:\n  language: zh\n");
		await writeFile(join(agentDir, "omomp.json"), '{"omomp-lang":{"language":"zh"}}');
		assert.equal(await runLanguage({ LANG: "en_US.UTF-8" }, agentDir), "en");
	} finally {
		await rm(agentDir, { force: true, recursive: true });
	}
});

test("environment normalization and locale precedence follow the family protocol", async () => {
	const cases: readonly { environment: Record<string, string>; expected: string }[] = [
		{ environment: { OMOMP_LANG: " ZH " }, expected: "zh" },
		{ environment: { OMOMP_LANG: "zh-CN", LANG: "en_US.UTF-8" }, expected: "en" },
		{ environment: { LC_ALL: "", LC_MESSAGES: "zh_CN.UTF-8" }, expected: "zh" },
		{ environment: { LC_ALL: "C", LANG: "zh_CN.UTF-8" }, expected: "en" },
		{ environment: { LC_ALL: " \t ", LC_MESSAGES: " ZH_CN.UTF-8 " }, expected: "zh" },
		{ environment: {}, expected: "en" },
	];
	for (const { environment, expected } of cases) {
		assert.equal(await runLanguage(environment), expected, JSON.stringify(environment));
	}
});

test("environment changes are live while the agent configuration is cached", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "omp-codex-image-gen-cache-"));
	try {
		await writeFile(join(agentDir, "omomp.json"), '{"omomp-lang":{"language":"zh"}}');
		const script = [
			`import { configureAgentDir, language } from ${JSON.stringify(MODULE_URL)};`,
			'import { writeFileSync } from "node:fs";',
			`configureAgentDir(${JSON.stringify(agentDir)});`,
			"const resolved = [language()];",
			`writeFileSync(${JSON.stringify(join(agentDir, "omomp.json"))}, '{"omomp-lang":{"language":"en"}}');`,
			"resolved.push(language());",
			'process.env.OMOMP_LANG = " EN ";',
			"resolved.push(language());",
			'process.env.OMOMP_LANG = "zh-CN";',
			"resolved.push(language());",
			"console.log(resolved.join(','));",
		].join("\n");
		const child = Bun.spawn([process.execPath, "-e", script], {
			env: { PATH: process.env.PATH ?? "", LANG: "en_US.UTF-8" },
			stderr: "pipe",
			stdout: "pipe",
		});
		const [status, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
		assert.equal(status, 0);
		assert.equal(output.trim(), "zh,zh,en,zh");
	} finally {
		await rm(agentDir, { force: true, recursive: true });
	}
});
