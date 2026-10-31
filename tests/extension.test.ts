import assert from "node:assert/strict";
import test from "node:test";

import { createCodexImageExtension } from "../index.ts";
import type { GenerateContext, GeneratedImage, ImageGenerator } from "../src/image-generator.ts";
import { tr } from "../src/i18n.ts";

function fakePi() {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	let tool: any;
	return {
		api: {
			on(name: string, handler: (...args: any[]) => unknown) {
				handlers.set(name, handler);
			},
			registerTool(definition: unknown) {
				tool = definition;
			},
		},
		handlers,
		get tool() {
			return tool;
		},
	};
}

function toolContext(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/work/project",
		hasUI: false,
		modelRegistry: {},
		sessionManager: { getSessionId: () => "session-id" },
		isProjectTrusted: () => true,
		ui: {
			confirm: async () => {
				throw new Error("codex_generate_image must not prompt for confirmation");
			},
		},
		...overrides,
	};
}

test("package extension registers codex_generate_image", async () => {
	const image: GeneratedImage = {
		base64: "png-base64",
		mimeType: "image/png",
		model: "gpt-image-2",
		savedPath: "/work/project/.pi/generated-images/session-id/fox.png",
		quality: "high",
		size: "1024x1024",
	};
	const calls: unknown[] = [];
	const generator: ImageGenerator = {
		generate: async (request, context) => {
			calls.push({ request, context });
			return image;
		},
	};
	const pi = fakePi();

	createCodexImageExtension(generator)(pi.api as never);

	assert.equal(pi.tool.name, "codex_generate_image");
	assert.equal(pi.tool.label, tr("Codex Generate Image", "Codex 生成图片"));
	assert.equal(pi.tool.parameters.properties.referencedImagePaths.minItems, 0);
	assert.equal(pi.tool.parameters.properties.referencedImagePaths.maxItems, 5);

	const result = await pi.tool.execute(
		"call-id",
		{ prompt: "fox", save: "auto", quality: "high", size: "1024x1024" },
		undefined,
		undefined,
		toolContext(),
	);

	assert.equal(calls.length, 1);
	assert.deepEqual(result.content, [
		{
			type: "text",
			text: "Generated PNG with gpt-image-2 and saved it to /work/project/.pi/generated-images/session-id/fox.png.",
		},
		{ type: "image", data: "png-base64", mimeType: "image/png" },
	]);
	assert.deepEqual(result.details, {
		model: "gpt-image-2",
		mimeType: "image/png",
		savedPath: image.savedPath,
		quality: "high",
		size: "1024x1024",
	});
	assert.equal(JSON.stringify(result.details).includes("png-base64"), false);
});

test("extension edits with local references in headless mode without confirmation", async () => {
	const generatedContexts: GenerateContext[] = [];
	const referencePlan = {
		count: 1,
		load: async () => [
			{ dataUrl: "data:image/png;base64,c291cmNl", mimeType: "image/png" },
		],
	};
	const planner = {
		plan: async (paths: readonly string[]) => {
			assert.deepEqual(paths, ["source.png"]);
			return referencePlan;
		},
	};
	const generator: ImageGenerator = {
		generate: async (_request, context) => {
			generatedContexts.push(context);
			return { base64: "edited", mimeType: "image/png", model: "gpt-image-2" };
		},
	};
	const pi = fakePi();
	createCodexImageExtension(generator, planner)(pi.api as never);

	const result = await pi.tool.execute(
		"call-id",
		{
			prompt: "replace background",
			referencedImagePaths: ["source.png"],
			save: "none",
		},
		undefined,
		undefined,
		toolContext(),
	);

	assert.equal(generatedContexts[0]?.referenceImages, referencePlan);
	assert.match(result.content[0].text, /^Edited PNG/);
	assert.equal(JSON.stringify(result.details).includes("source.png"), false);
	assert.equal(JSON.stringify(result.details).includes("c291cmNl"), false);
});

test("extension treats an empty reference array as generation", async () => {
	let plannerCalled = false;
	let generatedRequest: any;
	const generator: ImageGenerator = {
		generate: async (request) => {
			generatedRequest = request;
			return {
				base64: "generated",
				mimeType: "image/png",
				model: "gpt-image-2",
			};
		},
	};
	const planner = {
		plan: async () => {
			plannerCalled = true;
			throw new Error("planner must not run");
		},
	};
	const pi = fakePi();
	createCodexImageExtension(generator, planner)(pi.api as never);

	const result = await pi.tool.execute(
		"call-id",
		{ prompt: "new fox", referencedImagePaths: [], save: "none" },
		undefined,
		undefined,
		toolContext(),
	);

	assert.equal(plannerCalled, false);
	assert.equal(generatedRequest.referencedImagePaths, undefined);
	assert.match(result.content[0].text, /^Generated PNG/);
});
