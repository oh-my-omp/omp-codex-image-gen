import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Language = "en" | "zh";

/** The environment variable that names the UI language explicitly. */
export const LANGUAGE_ENV = "OMOMP_LANG";

const OMP_CONFIG_FILES = ["omomp.yml", "omomp.yaml", "omomp.json", "omomp.toml"] as const;
const LOCALE_VARIABLES = ["LC_ALL", "LC_MESSAGES", "LANG"] as const;

type ConfigRoot = Readonly<Record<string, unknown>>;

let agentDir: string | undefined;
let configRead = false;
let configuredLanguage: Language | null = null;

/** Bind the OMP host's agent directory without importing the host package here. */
export function configureAgentDir(value: string): void {
	if (!configRead) agentDir = value;
}

/** Resolve the current process language at the point of use. */
export function language(): Language {
	const configured = readConfiguredLanguage();
	const explicit = parseEnvironmentLanguage(process.env[LANGUAGE_ENV]);
	if (explicit !== null) return explicit;
	if (configured !== null) return configured;

	for (const key of LOCALE_VARIABLES) {
		const value = process.env[key]?.trim();
		if (value) return value.toLowerCase().startsWith("zh") ? "zh" : "en";
	}
	return "en";
}

/** Choose the text for the current language; English comes first at each use site. */
export function tr(en: string, zh: string): string {
	return language() === "zh" ? zh : en;
}

function readConfiguredLanguage(): Language | null {
	if (configRead) return configuredLanguage;
	configRead = true;
	if (!agentDir) return null;

	try {
		const paths = OMP_CONFIG_FILES.map((file) => join(agentDir as string, file)).filter((path) => existsSync(path));
		if (paths.length !== 1) return null;
		const path = paths[0] as string;
		const value = parseConfig(readFileSync(path, "utf8"), path);
		if (!isConfigRoot(value)) return null;
		const section = value["omomp-lang"];
		if (!isConfigRoot(section)) return null;
		configuredLanguage = parseConfiguredLanguage(section.language);
	} catch {
		configuredLanguage = null;
	}
	return configuredLanguage;
}

function parseConfig(text: string, path: string): unknown {
	if (path.endsWith(".yml") || path.endsWith(".yaml")) return Bun.YAML.parse(text);
	if (path.endsWith(".json")) return JSON.parse(text);
	return Bun.TOML.parse(text);
}

function isConfigRoot(value: unknown): value is ConfigRoot {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvironmentLanguage(value: string | undefined): Language | null {
	const normalized = value?.trim().toLowerCase();
	return normalized === "en" || normalized === "zh" ? normalized : null;
}

function parseConfiguredLanguage(value: unknown): Language | null {
	return value === "en" || value === "zh" ? value : null;
}
