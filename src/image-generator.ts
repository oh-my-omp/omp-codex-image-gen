import type { CodexAuth } from "./auth/codex-auth.ts";
import { ExtensionError } from "./errors.ts";
import type { PlannedReferenceImages } from "./input/reference-images.ts";
import { decodePngBase64 } from "./output/image-store.ts";
import { resolveOutputPlan, type ApprovedRootAnchor } from "./output/paths.ts";
import type { GenerateImageRequest, GeneratedImageData, ImageQuality, ImageSize } from "./types.ts";

export interface GenerateContext {
  cwd: string;
  agentDir: string;
  sessionId: string;
  projectTrusted: boolean;
  modelRegistry: unknown;
  signal?: AbortSignal | undefined;
  referenceImages?: PlannedReferenceImages | undefined;
}

export interface GeneratedImage {
  base64: string;
  mimeType: "image/png";
  model: "gpt-image-2";
  savedPath?: string;
  created?: number;
  quality?: string;
  size?: string;
}

export interface ImageGenerator {
  generate(request: GenerateImageRequest, context: GenerateContext): Promise<GeneratedImage>;
}

interface ImagesClient {
  generate(
    request: { prompt: string; quality: ImageQuality; size: ImageSize },
    auth: CodexAuth,
    signal?: AbortSignal,
  ): Promise<GeneratedImageData>;
  edit(
    request: { prompt: string; images: readonly string[]; quality: ImageQuality; size: ImageSize },
    auth: CodexAuth,
    signal?: AbortSignal,
  ): Promise<GeneratedImageData>;
}

interface ImageStoreLike {
  save(
    bytes: Buffer,
    desiredPath: string,
    signal?: AbortSignal,
    approvedRoot?: ApprovedRootAnchor,
  ): Promise<string>;
}

interface ImageGeneratorDependencies {
  resolveAuth(registry: unknown): Promise<CodexAuth>;
  client: ImagesClient;
  store: ImageStoreLike;
}

export class DefaultImageGenerator implements ImageGenerator {
  private readonly dependencies: ImageGeneratorDependencies;

  constructor(dependencies: ImageGeneratorDependencies) {
    this.dependencies = dependencies;
  }

  async generate(request: GenerateImageRequest, context: GenerateContext): Promise<GeneratedImage> {
    const prompt = validatePrompt(request.prompt);
    const normalizedRequest: GenerateImageRequest = { ...request, prompt };
    const output = resolveOutputPlan(normalizedRequest, {
      cwd: context.cwd,
      agentDir: context.agentDir,
      sessionId: context.sessionId,
      projectTrusted: context.projectTrusted,
    });
    const requestedReferences = request.referencedImagePaths?.length ?? 0;
    if (requestedReferences > 0 && context.referenceImages?.count !== requestedReferences) {
      throw new ExtensionError("INVALID_REQUEST", "Reference images were not prepared for this edit request.");
    }
    if (requestedReferences === 0 && context.referenceImages !== undefined) {
      throw new ExtensionError("INVALID_REQUEST", "Reference images were prepared for a generation request.");
    }

    // `references` held every dataUrl (~60 MB max). The loader below returns
    // only the dataUrl strings, so the per-file upstream array ends with the
    // helper frame; only the required `images` payload crosses into the client
    // (whose in-client retention is oh-my-omp/omp-codex-image-gen#4's).
    const imageUrls = await loadEditImageDataUrls(
      context.referenceImages,
      requestedReferences,
      context.signal,
    );
    const auth = await this.dependencies.resolveAuth(context.modelRegistry);
    const imageRequest = {
      prompt,
      quality: request.quality ?? "auto",
      size: request.size ?? "auto",
    };
    const generated = imageUrls.length > 0
      ? await this.dependencies.client.edit(
          { ...imageRequest, images: imageUrls },
          auth,
          context.signal,
        )
      : await this.dependencies.client.generate(imageRequest, auth, context.signal);
    const bytes = decodePngBase64(generated.base64);
    const savedPath = output.save
      ? await this.dependencies.store.save(bytes, output.desiredPath, context.signal, output.approvedRoot)
      : undefined;

    const result: GeneratedImage = {
      base64: generated.base64,
      mimeType: "image/png",
      model: "gpt-image-2",
    };
    if (savedPath !== undefined) result.savedPath = savedPath;
    if (generated.created !== undefined) result.created = generated.created;
    if (generated.quality !== undefined) result.quality = generated.quality;
    if (generated.size !== undefined) result.size = generated.size;
    return result;
  }
}

/**
 * Loads reference images and returns only their dataUrl payloads. The
 * `ResolvedReferenceImage[]` array (one entry per reference file) ends with
 * this helper frame, so no per-file upstream shape survives into the
 * auth/network awaits in `generate`.
 */
async function loadEditImageDataUrls(
  referenceImages: PlannedReferenceImages | undefined,
  requestedReferences: number,
  signal?: AbortSignal | undefined,
): Promise<string[]> {
  if (requestedReferences === 0) return [];
  const references = await referenceImages!.load(signal);
  return references.map((image) => image.dataUrl);
}

function validatePrompt(value: string): string {
  const prompt = value.trim();
  if (prompt.length === 0) {
    throw new ExtensionError("INVALID_REQUEST", "prompt must not be empty.");
  }
  if (prompt.length > 32_000) {
    throw new ExtensionError("INVALID_REQUEST", "prompt is too long (maximum 32,000 characters).");
  }
  return prompt;
}
