# Oh My Pi Codex Image Gen

English | [简体中文](README.zh-CN.md)

Generate and edit PNG images in [Oh My Pi](https://omp.sh/) (`omp`) through the
same ChatGPT-backed Codex Images flow used by the built-in Codex CLI experience.
Authentication comes from the ChatGPT Plus/Pro Codex login already managed by
`omp`. **NO `OPENAI_API_KEY` is required.**

This is an `omp` port of
[`@crazygit/pi-codex-image-gen`](https://github.com/crazygit/pi-codex-image-gen):
the behavior is unchanged; only the host-package bindings that broke under `omp`
were repaired (see [Port notes](#port-notes)).

> Image requests follow the same provider-managed service access and usage
> policies as Codex CLI. This project does not define an additional allowance
> or limit, and provider behavior may change independently of this package.

## Highlights

- Generate one PNG from a natural-language prompt.
- Edit or derive from one to five local PNG, JPEG, or WebP images.
- Preview every result inline and save it automatically by default.
- Run without interactive confirmation, including headless sessions.
- Keep OAuth tokens, backend responses, and image bytes out of result metadata.
- Bound input dimensions, request sizes, response sizes, and retries.
- Save atomically without silently overwriting existing files.
- Bundle an `imagegen` skill that activates only for explicit image requests.

## Requirements

- Oh My Pi (`omp`) `18.2.6` or a compatible later release
- Bun `1.3.14+` (the `omp` runtime)
- An active ChatGPT Plus/Pro Codex login (`/login` → ChatGPT Plus/Pro)

## Installation

The package is not published to npm; install it from GitHub:

```bash
omp install https://github.com/oh-my-omp/omp-codex-image-gen
```

A GitHub install tracks the default branch; re-run the same command to update,
then restart `omp`.

### Local checkout

Load a checkout for one session without changing `omp` settings:

```bash
omp -e /absolute/path/to/omp-codex-image-gen
```

## UI language

The tool label and in-progress status follow `OMOMP_LANG` when its value, after trimming whitespace and ignoring case, is `en` or `zh`. Otherwise, the extension reads the `omomp-lang` section from exactly one agent-directory `omomp.yml`, `omomp.yaml`, `omomp.json`, or `omomp.toml` file:

```yaml
omomp-lang:
  language: zh
```

The section accepts only the `language` field with the exact value `en` or `zh`; configuration values are not trimmed or case-normalized. Invalid files or sections, and multiple candidate files in the agent directory, are ignored. Project `.omp/` configuration is not read. The agent setting is cached for the process; changes apply after restarting `omp`.

If the agent setting is absent or invalid, the first non-empty `LC_ALL`, `LC_MESSAGES`, or `LANG` value after trimming whitespace selects Chinese when it starts with `zh` (case-insensitive); otherwise the UI is English. With no setting or locale, English is used. Environment variables are read again whenever UI text is generated.

## Usage

### Start with natural language

In normal use, you do **not** need to call the tool manually or write JSON.
Describe the image you want, and include only the options that matter to you.
The bundled `imagegen` skill maps the request to `codex_generate_image`.

Make a simple request:

> Generate a square watercolor fox avatar with a pale blue background.

Choose the shape, quality, and destination explicitly:

> Generate a high-quality landscape hero image of a mountain observatory at
> night. Use a 1536x1024 canvas and save it to assets/observatory.png.

Edit a local image while preserving explicit invariants:

> Edit assets/fox.png. Keep the fox's pose, colors, and position unchanged;
> replace only the background with a sunset. Save the result to
> assets/fox-sunset.png.

Preview without saving:

> Generate a low-quality square draft of a blue app icon. Preview it without
> saving.

`omp` infers the tool arguments from these instructions. If you do not mention a
size or quality, the extension uses provider defaults. Every successful result
is previewed inline and, by default, also saved automatically. Ask to preview
without saving when you do not want a local file.

### Advanced: tool arguments

<details>
<summary>View the structured arguments omp sends to the extension</summary>

These fields are the internal contract between `omp` and the extension. Most
users never need to set them manually.

| Parameter | Default | Purpose |
| --- | --- | --- |
| `prompt` | Required | Final image description or edit instruction. |
| `referencedImagePaths` | Omitted | One to five local PNG, JPEG, or WebP paths; supplying them selects edit mode. |
| `outputPath` | Omitted | Requested `.png` destination; safety checks or name collisions may adjust the final path. |
| `save` | `auto` | Automatic save, preview only, project storage, or agent storage. |
| `size` | `auto` | `1024x1024`, `1536x1024`, or `1024x1536`. |
| `quality` | `auto` | `low`, `medium`, or `high`. |

**Size values**

| Value | Shape | Typical use |
| --- | --- | --- |
| `auto` | Provider-selected | No strict layout requirement. |
| `1024x1024` | Square | Icons, avatars, product tiles, social posts. |
| `1536x1024` | Landscape | Hero images, banners, scenes, presentation art. |
| `1024x1536` | Portrait | Posters, covers, character art, mobile layouts. |

**Save values**

| Value | Behavior |
| --- | --- |
| `auto` | Use the trusted project when available; otherwise use the agent directory. |
| `project` | Save under `<cwd>/.pi/generated-images/<session-id>/`; requires a trusted project. |
| `global` | Save under `<agent-dir>/generated-images/<session-id>/`. |
| `none` | Return the inline preview without writing a file. |

`outputPath` takes precedence over the automatic `project` or `global` location
and cannot be combined with `save: "none"`. Relative paths require a trusted
project and must stay inside it. An absolute path may point anywhere writable.
Existing files are never silently overwritten; a collision
receives a numeric suffix, which is reflected in the returned `savedPath`.

</details>

### Reference images

Supplying `referencedImagePaths` switches from generation to editing. The listed
local files are read and uploaded to Codex without an interactive prompt,
including in headless runs. Relative paths require a trusted project.

Direct selection of attached or recent conversation images is not implemented;
provide a local path instead.

### Result

Every successful call returns an inline `omp` image block. Saving is enabled by
default, so the result normally also includes the final `savedPath`. A request
to preview without saving returns only the inline image. Result metadata
includes small fields such as model, size, quality, and saved path.

## How it works

- `omp` resolves the existing Codex login through
  `ctx.modelRegistry.getApiKeyAndHeaders()`; the package never reads
  `auth.json` directly.
- Requests are restricted to the current Codex Images generation and edit
  endpoints on `chatgpt.com`; redirects and unexpected destinations are
  rejected.
- The request model is fixed to `gpt-image-2`.
- Selected transient gateway failures are retried once with bounded backoff;
  ambiguous transport failures and malformed success responses are not retried.
- The flow mirrors the current built-in Codex CLI image path rather than the
  public API-key Images product.

The ChatGPT-backed Codex Images endpoints are not a public stable API. Provider
changes may require a package update.

## Port notes

Everything except the host-package bindings is copied verbatim from upstream.
Three touch points that upstream imported from `@earendil-works/pi-coding-agent`
do not exist (or moved) in `omp`, so they were repaired:

- `withFileMutationQueue` is not exported by `omp`. `src/output/image-store.ts`
  now keeps an equivalent per-path promise queue local to the image store.
- `resizeImage` moved to `@oh-my-pi/pi-coding-agent/utils/image-resize` and
  changed signature (`resizeImage(ImageContent, options)` returning an object
  whose `.data` is the base64 payload). `src/input/reference-images.ts` adapts
  its default normalizer accordingly.
- `StringEnum` (`pi-ai`) and `ctx.signal` were removed. `index.ts` builds the
  same `{ type: "string", enum: [...] }` wire schema as a union of TypeBox
  literals and relies solely on the tool `execute` abort signal.

## Limitations

The current release creates one PNG at a time. It does not support masks,
batches, direct conversation-image selection, API-key fallback,
Responses-tool compatibility, alternate image backends, JPEG/WebP output,
native transparency controls, or telemetry.

## Development

```bash
bun install
bun run check
bun test
```

Load a local checkout without changing `omp` settings:

```bash
omp -e /absolute/path/to/omp-codex-image-gen
```

Automated tests use in-memory transports and do not contact OpenAI or make real
image requests.

## License

[MIT](LICENSE)
