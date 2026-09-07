# StyleLens

<p align="center">
  <img src="apps/extension/public/stylelens-icon.svg" width="48" height="48" alt="StyleLens">
</p>

<p align="center"><strong>把网页上的 UI 选出来，交给 AI 复刻。</strong></p>

<p align="center">
  StyleLens 是一个 Manifest V3 Chrome 扩展。它从选中的 DOM 元素提取结构、样式、布局和交互线索，并按用户选择的分析模式生成可直接交给 AI 编程工具的 UI 重建 Prompt。
</p>

<p align="center">
  <a href="README_EN.md">English</a> |
  <a href="https://gitee.com/xxxlomg/shark-style-lens">Gitee 源码</a>
</p>

## 能做什么

- 选择网页上的元素，或将一个子元素扩展为完整复合组件。
- 解析 DOM 子树、语义角色、布局关系、计算样式、页面主题和响应式信息。
- 按需截取选中元素的可见矩形，发送精准 PNG 给 Vision 模型，避免周边 UI 干扰。
- 支持模板、文字模型、视觉增强三种分析模式，用户可以自主选择是否使用 LLM 和 Vision。
- 在页面浮层中流式查看结果，一键复制 Prompt，失败时可以重试。
- 通过本地 API 服务统一管理 DeepSeek Key 和分析模式；浏览器扩展不保存云端 API Key。

## 工作方式

```text
网页元素
   |
   +-- DOM / CSS / layout / interaction analysis
   |
   +-- template -> local Prompt Compiler
   |
   +-- text -> Agent（仅文字）
   |
   +-- multimodal -> captureVisibleTab -> Vision -> Agent
   |
   +-- streamed reconstruction prompt
   |
   `-- 页面浮层 -> 查看 / 复制 / 重新选择
```

## 分析模式

所有模式都会先运行本地 DOM/CSS/布局解析。分析模式决定后续是否截图、是否调用 LLM：

| 模式     | 处理方式                                               | 是否调用 LLM | 是否发送截图 |
| -------- | ------------------------------------------------------ | ------------ | ------------ |
| 模板模式 | 由本地确定性 Prompt Compiler 将解析结果回填为 Prompt   | 否           | 否           |
| 文字模型 | 将 DOM Profile 发送给文字 Agent 生成 Prompt            | 是           | 否           |
| 视觉增强 | 先由 Vision 生成结构化视觉证据，再由 Agent 生成 Prompt | 是           | 是           |

默认使用“视觉增强”。模板模式不需要 DeepSeek API Key；文字模型不产生或发送视觉截图；视觉增强适合追求最高视觉还原度的场景。三种模式均复用同一套 DOM/CSS 解析结果，便于比较输出差异。

## 项目结构

```text
apps/extension/     Chrome MV3 扩展、background、content script、popup
apps/desktop/       Windows Tauri 壳、配置向导和 API sidecar
services/api/       本地 Hono API、SSE、DeepSeek Provider
packages/            共享类型与接口契约
```

## 环境要求

- Node.js 22 或更高版本
- pnpm 9 或更高版本
- Chrome 或 Chromium
- 可选：DeepSeek API Key。没有 Key 时使用本地 mock，便于开发和测试。

## 桌面版（Windows）

桌面版会自动启动本地 API，不需要用户手动打开命令行或维护 `.env`。首次启动时选择分析模式、填写 DeepSeek API Key 和配置思考模式，配置会保存到：

```text
%APPDATA%\shark\shark-style-lens\config.json
```

扩展 Popup 中的 `Save captures` 只在浏览器本地保存当前精确 PNG 裁剪图，文件会进入 Chrome 的默认下载目录，不写入 API 配置目录。

桌面版安装包构建命令：

```powershell
pnpm install
pnpm desktop:build
```

安装包输出在 `apps/desktop/src-tauri/target/release/bundle/nsis/`。程序启动后会显示配置向导；配置保存后，再下载并安装唯一的扩展 ZIP 入口。API sidecar 固定监听 `127.0.0.1:3001`，桌面面板和浏览器扩展通过这个稳定地址访问同一个本地配置。API Key 只由本机 sidecar 读取，不会进入扩展 bundle、网页或日志。

`apps/desktop/src-tauri/target/`、`apps/desktop/src-tauri/binaries/`、`apps/desktop/src-tauri/resources/`、`apps/desktop/dist/` 和 `services/api/public/stylelens.zip` 都是构建生成物，不需要提交到源码仓库。

开发时可以直接运行：

```powershell
pnpm desktop:dev
```

## 开发版快速开始

在仓库根目录执行：

```powershell
pnpm install
Copy-Item services/api/.env.example services/api/.env
```

编辑 `services/api/.env`，至少配置：

```dotenv
STYLELENS_API_SECRET=stylelens-dev
DEEPSEEK_API_KEY=your_deepseek_api_key
```

启动本地 API：

```powershell
pnpm --filter @stylelens/api dev
```

另开一个终端构建扩展：

```powershell
pnpm --filter @stylelens/extension build
```

构建完成后，在 Chrome 中执行：

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `apps/extension/dist` 目录。
5. 打开任意网页，按 `Alt+Shift+S`，或点击扩展图标开始选择。

本地安装页也会提供 ZIP 下载：`http://127.0.0.1:3001`。下载后解压，再按上述步骤加载解压目录。

## 使用流程

1. 启动选择模式，移动鼠标查看目标元素高亮。
2. 点击目标元素，在控制条中选择 `Element` 或 `Component` 范围。
3. 点击 `Analyze`。
4. 等待所选模式完成分析和 Prompt 生成。
5. 点击 `Copy Prompt`，粘贴到 Claude、Cursor、Codex 或其他 AI 编程工具。

如果开启扩展 Popup 中的 `Save captures`，视觉增强模式生成的 PNG 会通过浏览器下载到 `stylelens/` 文件夹。模板模式和文字模型不会截图。

## 配置

| 环境变量                       | 默认值                         | 作用                                          |
| ------------------------------ | ------------------------------ | --------------------------------------------- |
| `PORT`                         | `3001`                         | 本地 API 端口                                 |
| `STYLELENS_API_SECRET`         | `stylelens-dev`                | 扩展与本地 API 的共享密钥                     |
| `DEEPSEEK_API_KEY`             | 空                             | DeepSeek 云端 API Key                         |
| `DEEPSEEK_BASE_URL`            | `https://api.deepseek.com`     | DeepSeek API 地址                             |
| `DEEPSEEK_MODEL`               | `deepseek-v4-flash`            | Agent Slot 模型                               |
| `DEEPSEEK_VISION_MODEL`        | `deepseek-v4-flash-vision-exp` | Vision Slot 模型                              |
| `DEEPSEEK_VISION_TEMPERATURE`  | `0.1`                          | Vision 结构化分析温度                         |
| `DEEPSEEK_VISION_IMAGE_DETAIL` | `auto`                         | Vision 图片细节级别                           |
| `DEEPSEEK_VISION_MAX_IMAGES`   | `4`                            | API 允许的单次图片上限；当前扩展实际发送 1 张 |

桌面版优先使用 `%APPDATA%\shark\shark-style-lens\config.json`。开发时仍可使用 `services/api/.env` 覆盖配置；桌面发行版会显式关闭 `.env` 加载，避免把开发机环境带入用户程序。

`analysisMode` 默认是 `multimodal`，可选 `template`、`text`、`multimodal`。`thinkingEnabled` 默认关闭；开启后可选择 `low`、`high` 或 `max`，Agent 的 `reasoning_content` 会通过本地 SSE 流实时显示在扩展面板中。模板模式不使用思考能力；Vision 结构化分析始终关闭思考模式，以保持 JSON 输出稳定。

## 权限与隐私

- 扩展使用 `activeTab`、`scripting` 和 `storage`。
- `<all_urls>` 用于保证用户点击分析后，异步截图阶段仍然具备页面访问权限。
- 只有视觉增强模式会在 background 内存中短暂处理截图；启用 `Save captures` 后，副本通过浏览器下载到 `stylelens/`。
- 扩展只向本地 `localhost` / `127.0.0.1` API 发请求，地址配置经过回环地址校验。
- DeepSeek Key 只放在本机配置文件或开发环境 `services/api/.env`，不会打包进扩展。
- 日志记录请求阶段、模型、图片数量和 trace id，不记录 API Key、页面 DOM、Prompt 或图片内容。

## 故障排查

打开 `chrome://extensions`，找到 StyleLens 的 `Service worker` 并点击 `Inspect`，重点查看：

```text
[StyleLens][API] vision:capture:complete  截图完成，包含尺寸和裁剪坐标
[StyleLens][API] vision:request:start    已发送 1 张图片给 Vision
[StyleLens][API] vision:complete         Vision 已返回结构化证据
[StyleLens][API] agent:request:start     已向 Agent 请求 Prompt
[StyleLens][API] agent:complete          Prompt 流式输出完成
[StyleLens][API] request:failed           失败原因和 trace id
```

本地 API 终端中的 `model:request-sent` 才代表真正向 DeepSeek 发起了远程请求。没有配置 Key 时，日志会显示 `execution: local-mock`。

## 开发命令

```powershell
pnpm --filter @stylelens/extension test
pnpm --filter @stylelens/extension typecheck
pnpm --filter @stylelens/extension lint
pnpm --filter @stylelens/extension test:e2e
pnpm --filter @stylelens/api test
pnpm build
pnpm desktop:build
```

图标源文件位于 `apps/extension/public/stylelens-icon.svg`，扩展使用的 PNG 尺寸为 `16`、`32`、`48` 和 `128`。SVG 是主设计源，修改图标后需要重新导出这些 PNG 并重新执行构建。

---

## 🤝 贡献

本项目由 xxxlomg 开发，仅供学习和个人使用。
问题与建议请到[正式版入口](https://gitee.com/xxxlomg/shark-style-lens)提 Issue。

## 📄 License

本项目基于 **Apache License 2.0** 开源，详见根目录 [LICENSE](LICENSE)。
