/** Oh My Pi package entrypoint declared by package.json#omp.extensions. */
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionFactory,
	type ModelRegistry,
} from "@oh-my-pi/pi-coding-agent";
import { Type as TypeBoxBuilder } from "typebox";
import type * as OmpTypeBox from "@oh-my-pi/omptype/typebox";

import { resolveCodexAuth } from "./src/auth/codex-auth.ts";
import {
	CodexImagesClient,
	FetchHttpTransport,
} from "./src/client/codex-images.ts";
import { ExtensionError } from "./src/errors.ts";
import {
	DefaultImageGenerator,
	type GeneratedImage,
	type ImageGenerator,
} from "./src/image-generator.ts";
import {
	ReferenceImagePlanner,
	type PlannedReferenceImages,
	type ReferenceImagePlanning,
} from "./src/input/reference-images.ts";
import { ImageStore } from "./src/output/image-store.ts";
import type { GenerateImageRequest } from "./src/types.ts";
import { configureAgentDir, tr } from "./src/i18n.ts";

// Oh My Pi rewrites the `typebox` specifier to its omptype-backed TypeBox shim at
// extension-load time, so the runtime builder emits the omptype schemas the tool
// registry accepts. The local `tsc`/test build resolves the real `typebox`
// package instead; this cast pins the compile-time view to the shim's schema type
// (`@oh-my-pi/omptype/typebox`) so `parameters` satisfies `registerTool`.
const Type = TypeBoxBuilder as unknown as typeof OmpTypeBox.Type;

/**
 * Build a `{ type: "string", enum: [...] }` schema from a fixed value set.
 * Upstream used `StringEnum` from `pi-ai`, which Oh My Pi removed; a union of
 * literals emits the same wire schema while preserving the exact value union.
 */
const stringEnum = <T extends string>(
	values: readonly T[],
	options?: { description?: string },
) =>
	Type.Union(
		values.map((value) => Type.Literal(value)),
		options,
	);

const PARAMETERS = Type.Object(
	{
		prompt: Type.String({
			description:
				"A concise natural-language description of the new image or requested edit.",
		}),
		referencedImagePaths: Type.Optional(
			Type.Array(
				Type.String({
					description:
						"Local PNG, JPEG, or WebP path to upload as an edit/reference input.",
				}),
				{
					minItems: 0,
					maxItems: 5,
					description:
						"One to five local images. When provided, the tool edits or derives from these images.",
				},
			),
		),
		outputPath: Type.Optional(
			Type.String({
				description:
					"Exact PNG destination. Relative paths must stay inside a trusted project.",
			}),
		),
		save: Type.Optional(
			stringEnum(["auto", "none", "project", "global"] as const, {
				description:
					"Where to save the PNG. auto uses a trusted project, otherwise the global agent directory.",
			}),
		),
		size: Type.Optional(
			stringEnum(["auto", "1024x1024", "1536x1024", "1024x1536"] as const),
		),
		quality: Type.Optional(
			stringEnum(["auto", "low", "medium", "high"] as const),
		),
	},
	{ additionalProperties: false },
);

function productionGenerator(): ImageGenerator {
	return new DefaultImageGenerator({
		resolveAuth: (registry) => resolveCodexAuth(registry as ModelRegistry),
		client: new CodexImagesClient(new FetchHttpTransport()),
		store: new ImageStore(),
	});
}

export function createCodexImageExtension(
	generator: ImageGenerator = productionGenerator(),
	referencePlanner: ReferenceImagePlanning = new ReferenceImagePlanner(),
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		configureAgentDir(getAgentDir());
		pi.registerTool({
			name: "codex_generate_image",
			label: tr("Codex Generate Image", "Codex 生成图片"),
			description:
				"Generate or edit one PNG with gpt-image-2 through the ChatGPT-backed Codex Images flow used by Codex CLI. Provide referencedImagePaths to edit or derive from one to five local PNG, JPEG, or WebP images.",
			parameters: PARAMETERS,
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const request: GenerateImageRequest = { ...params };
				if (request.referencedImagePaths?.length === 0) {
					delete request.referencedImagePaths;
				}
				const pathContext = {
					cwd: ctx.cwd,
					agentDir: getAgentDir(),
					sessionId: ctx.sessionManager.getSessionId(),
					projectTrusted: ctx.isProjectTrusted(),
				};
				let referenceImages: PlannedReferenceImages | undefined;
				if (request.referencedImagePaths !== undefined) {
					try {
						referenceImages = await referencePlanner.plan(
							request.referencedImagePaths,
							pathContext,
						);
					} catch (error) {
						if (error instanceof ExtensionError) throw toolError(error);
						throw toolError(
							new ExtensionError(
								"INPUT_IMAGE_INVALID",
								"Reference images could not be prepared.",
							),
						);
					}
				}

				onUpdate?.({
					content: [
						{
							type: "text",
							text: referenceImages
								? tr("Editing one PNG through Codex Images...", "正在通过 Codex Images 编辑一张 PNG……")
								: tr("Generating one PNG through Codex Images...", "正在通过 Codex Images 生成一张 PNG……"),
						},
					],
					details: {},
				});
				try {
					const image = await generator.generate(request, {
						...pathContext,
						modelRegistry: ctx.modelRegistry,
						signal,
						referenceImages,
					});
					return toolResult(image, referenceImages !== undefined);
				} catch (error) {
					if (error instanceof ExtensionError) throw toolError(error);
					throw toolError(
						new ExtensionError(
							"BACKEND_UNAVAILABLE",
							"Image generation failed unexpectedly.",
						),
					);
				}
			},
		});
	};
}

function toolResult(image: GeneratedImage, edited = false) {
	const verb = edited ? "Edited" : "Generated";
	const text = image.savedPath
		? `${verb} PNG with ${image.model} and saved it to ${image.savedPath}.`
		: `${verb} PNG with ${image.model} without saving it.`;
	const details: Record<string, string | number> = {
		model: image.model,
		mimeType: image.mimeType,
	};
	if (image.savedPath !== undefined) details.savedPath = image.savedPath;
	if (image.created !== undefined) details.created = image.created;
	if (image.quality !== undefined) details.quality = image.quality;
	if (image.size !== undefined) details.size = image.size;
	return {
		content: [
			{ type: "text" as const, text },
			{ type: "image" as const, data: image.base64, mimeType: image.mimeType },
		],
		details,
	};
}

function toolError(error: ExtensionError): Error {
	return new Error(`${error.code}: ${error.message}`);
}

export default createCodexImageExtension();
