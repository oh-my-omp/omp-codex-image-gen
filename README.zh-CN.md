# Oh My Pi Codex Image Gen

[English](README.md) | 简体中文

在 [Oh My Pi](https://omp.sh/)（`omp`）里生成和编辑 PNG 图片，走的是 Codex CLI 内置图片功能所用的同一条 ChatGPT 后端 Codex Images 流程。认证使用 `omp` 已经管理的 ChatGPT Plus/Pro Codex 登录，**不需要 `OPENAI_API_KEY`**。

本项目是 [`@crazygit/pi-codex-image-gen`](https://github.com/crazygit/pi-codex-image-gen) 的 `omp` 移植版：行为不变，只修复了在 `omp` 下失效的宿主包绑定（见[移植说明](#移植说明)）。

> 图片请求遵循与 Codex CLI 相同的、由服务方管理的访问和用量政策。本项目不另设额度或限制，服务方的行为可能独立于本包发生变化。

## 特性

- 根据自然语言提示生成一张 PNG。
- 基于一到五张本地 PNG、JPEG 或 WebP 图片进行编辑或派生。
- 每个结果都在会话内预览，默认自动保存。
- 无需交互确认，无头会话也能运行。
- 结果元数据里不含 OAuth token、后端响应和图片字节。
- 限制输入尺寸、请求大小、响应大小和重试次数。
- 原子写入，绝不静默覆盖已有文件。
- 附带 `imagegen` 技能，只在明确要求生成图片时激活。

## 要求

- Oh My Pi（`omp`）`18.2.6` 或兼容的更新版本
- Bun `1.3.14+`（`omp` 的运行时）
- 有效的 ChatGPT Plus/Pro Codex 登录（`/login` → ChatGPT Plus/Pro）

## 安装

本包没有发布到 npm，从 GitHub 安装：

```bash
omp install https://github.com/oh-my-omp/omp-codex-image-gen
```

从 GitHub 安装会跟随默认分支；更新时重新执行同一条命令，然后重启 `omp`。

### 本地检出

不改 `omp` 设置，只在一次会话里加载本地检出：

```bash
omp -e /absolute/path/to/omp-codex-image-gen
```

## 界面语言

工具标签和运行中状态优先使用 `OMOMP_LANG`（去掉首尾空白后不区分大小写，仅接受 `en` 或 `zh`）。否则，扩展会从 agent 目录中唯一的 `omomp.yml`、`omomp.yaml`、`omomp.json` 或 `omomp.toml` 文件读取 `omomp-lang` 配置：

```yaml
omomp-lang:
  language: zh
```

配置段只接受 `language` 字段，值必须是精确的 `en` 或 `zh`，不去空白、不转换大小写。文件或配置段无效，以及 agent 目录中同时存在多个候选文件时，都会跳过此设置。不读取项目 `.omp/` 配置。agent 配置在进程内缓存，修改后需重启 `omp`。

如果 agent 配置缺失或无效，则按 `LC_ALL`、`LC_MESSAGES`、`LANG` 的顺序取去掉首尾空白后的第一个非空值；值以 `zh` 开头时使用中文（不区分大小写），否则使用英文。没有配置或 locale 时默认使用英文。每次生成界面文字时都会重新读取环境变量。

## 用法

### 直接用自然语言

正常使用时**不需要**手动调用工具或写 JSON。描述你想要的图片，只说你在意的选项即可。附带的 `imagegen` 技能会把请求映射到 `codex_generate_image`。

简单请求：

> 生成一张正方形水彩狐狸头像，浅蓝色背景。

明确指定形状、质量和保存位置：

> 生成一张高质量的横版主视觉：夜晚的山顶天文台。使用 1536x1024 画布，保存到 assets/observatory.png。

编辑本地图片并写明不变量：

> 编辑 assets/fox.png。狐狸的姿势、颜色和位置保持不变，只把背景换成日落。结果保存到 assets/fox-sunset.png。

只预览不保存：

> 生成一张低质量的正方形蓝色应用图标草稿，只预览，不保存。

`omp` 会从这些说明推断工具参数。没提尺寸或质量时，扩展使用服务方默认值。每个成功结果都会在会话内预览，默认还会自动保存；不想留下本地文件时，要求只预览不保存。

### 进阶：工具参数

<details>
<summary>查看 omp 发给扩展的结构化参数</summary>

这些字段是 `omp` 与扩展之间的内部契约，多数用户不需要手动设置。

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `prompt` | 必填 | 最终的图片描述或编辑指令。 |
| `referencedImagePaths` | 不传 | 一到五个本地 PNG、JPEG 或 WebP 路径；提供后进入编辑模式。 |
| `outputPath` | 不传 | 期望的 `.png` 保存路径；安全检查或重名可能调整最终路径。 |
| `save` | `auto` | 自动保存、只预览、保存到项目或保存到 agent 目录。 |
| `size` | `auto` | `1024x1024`、`1536x1024` 或 `1024x1536`。 |
| `quality` | `auto` | `low`、`medium` 或 `high`。 |

**`size` 取值**

| 取值 | 形状 | 典型用途 |
| --- | --- | --- |
| `auto` | 由服务方选择 | 没有严格的版式要求。 |
| `1024x1024` | 正方形 | 图标、头像、产品卡片、社交媒体帖子。 |
| `1536x1024` | 横版 | 主视觉、横幅、场景图、演示配图。 |
| `1024x1536` | 竖版 | 海报、封面、角色图、移动端版式。 |

**`save` 取值**

| 取值 | 行为 |
| --- | --- |
| `auto` | 有受信任项目时存到项目里，否则存到 agent 目录。 |
| `project` | 存到 `<cwd>/.pi/generated-images/<session-id>/`；需要受信任项目。 |
| `global` | 存到 `<agent-dir>/generated-images/<session-id>/`。 |
| `none` | 只返回会话内预览，不写文件。 |

`outputPath` 优先于 `project` 或 `global` 的自动位置，不能与 `save: "none"` 同时使用。相对路径需要受信任项目，且必须留在项目内；绝对路径可以指向任何可写位置。已有文件绝不会被静默覆盖：重名时加数字后缀，返回的 `savedPath` 反映最终路径。

</details>

### 参考图片

提供 `referencedImagePaths` 就从生成切换到编辑。列出的本地文件会被读取并上传给 Codex，不弹交互确认，无头运行也一样。相对路径需要受信任项目。

不支持直接选取对话里附带或最近出现的图片，请提供本地路径。

### 结果

每次成功调用都返回一个会话内的 `omp` 图片块。默认开启保存，所以结果通常还包含最终的 `savedPath`；要求只预览不保存时只返回会话内图片。结果元数据只含模型、尺寸、质量、保存路径等少量字段。

## 工作原理

- `omp` 通过 `ctx.modelRegistry.getApiKeyAndHeaders()` 解析已有的 Codex 登录；本包从不直接读取 `auth.json`。
- 请求只发往 `chatgpt.com` 上当前的 Codex Images 生成和编辑端点；重定向和意外目标一律拒绝。
- 请求模型固定为 `gpt-image-2`。
- 部分暂时性网关错误会在有限退避后重试一次；含义不明的传输错误和格式错误的成功响应不重试。
- 这条流程对应 Codex CLI 当前内置的图片路径，而不是使用 API key 的公开 Images 产品。

ChatGPT 后端的 Codex Images 端点不是公开的稳定 API，服务方变化后可能需要更新本包。

## 移植说明

除宿主包绑定外，其余代码都原样复制自上游。上游从 `@earendil-works/pi-coding-agent` 导入的三处接口在 `omp` 里不存在或已移动，因此做了修复：

- `omp` 不导出 `withFileMutationQueue`。`src/output/image-store.ts` 在图片存储内部保留了一个等价的按路径 promise 队列。
- `resizeImage` 移到了 `@oh-my-pi/pi-coding-agent/utils/image-resize`，签名也变了（`resizeImage(ImageContent, options)`，返回对象的 `.data` 是 base64 数据）。`src/input/reference-images.ts` 相应调整了默认的规范化函数。
- `StringEnum`（`pi-ai`）和 `ctx.signal` 已被移除。`index.ts` 用 TypeBox 字面量的联合构造同样的 `{ type: "string", enum: [...] }` 线上 schema，并且只依赖工具 `execute` 的 abort signal。

## 限制

当前版本一次只生成一张 PNG。不支持蒙版、批量、直接选取对话图片、API key 回退、Responses 工具兼容、其他图片后端、JPEG/WebP 输出、原生透明度控制和遥测。

## 开发

```bash
bun install
bun run check
bun test
```

不改 `omp` 设置加载本地检出：

```bash
omp -e /absolute/path/to/omp-codex-image-gen
```

自动化测试使用内存传输，不连接 OpenAI，也不发出真实的图片请求。

## 许可

[MIT](LICENSE)
