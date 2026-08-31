# StyleLens

<p align="center">
  <img src="apps/extension/public/stylelens-icon.svg" width="48" height="48" alt="StyleLens">
</p>

<p align="center"><strong>把网页上的 UI 选出来，交给 AI 复刻。</strong></p>

<p align="center">
  StyleLens 是一个 Manifest V3 Chrome 扩展。它从选中的 DOM 元素提取结构、样式、布局和交互线索，结合一张精准的视觉截图，生成可直接交给 AI 编程工具的 UI 重建 Prompt。
</p>

<p align="center">
  <a href="README_EN.md">English</a> |
  <a href="https://gitee.com/xxxlomg/shark-style-lens">Gitee 源码</a>
</p>

## 能做什么

- 选择网页上的元素，或将一个子元素扩展为完整复合组件。
- 解析 DOM 子树、语义角色、布局关系、计算样式、页面主题和响应式信息。
- 只截取选中元素的可见矩形，发送一张精准 PNG 给 Vision 模型，避免周边 UI 干扰。
- 先生成结构化视觉证据，再交给 Agent Slot 编译高保真重建 Prompt。
- 在页面浮层中流式查看结果，一键复制 Prompt，失败时可以重试。
- 通过本地 API 服务统一保存 DeepSeek Key、截图目录和调试截图开关，浏览器扩展不保存云端 API Key。

## 工作方式

```text
网页元素
   |
   +-- DOM / CSS / layout / interaction analysis
   |
   +-- captureVisibleTab -> getBoundingClientRect() 精准裁剪 -> 1 张 target PNG
   |
   +-- Vision Slot -> structured visual evidence
   |
   +-- Agent Slot + StyleProfile -> streamed reconstruction prompt
   |
   `-- 页面浮层 -> 查看 / 复制 / 重新选择
```

每次分析包含两次模型请求：

1. 一次 Vision 请求：只携带选中目标的单张截图和脱敏后的组件清单。
2. 一次 Agent 请求：携带 DOM Profile 与 Vision 结构化证据，流式生成 Prompt。

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

桌面版会自动启动本地 API，不需要用户手动打开命令行或维护 `.env`。首次启动时填写 DeepSeek API Key 和思考模式，配置会保存到：

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
4. 等待 Vision 分析和 Prompt 流式生成完成。
5. 点击 `Copy Prompt`，粘贴到 Claude、Cursor、Codex 或其他 AI 编程工具。

如果要查看实际发送给 Vision 的图片，在桌面面板的高级设置中打开“保留调试截图”。扩展弹窗会从本地 API 回显这个状态；截图会保存到配置的临时目录，并且每次分析只生成一个目标 PNG。

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

`thinkingEnabled` 默认关闭；开启后可选择 `low`、`high` 或 `max`，Agent 的 `reasoning_content` 会通过本地 SSE 流实时显示在扩展面板中。Vision 结构化分析始终关闭思考模式，以保持 JSON 输出稳定。

## 权限与隐私

- 扩展使用 `activeTab`、`scripting` 和 `storage`。
- `<all_urls>` 用于保证用户点击分析后，异步截图阶段仍然具备页面访问权限。
- 截图只在 background 内存中短暂处理；启用保留调试截图后，由本地 API 写入配置的临时目录。
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
