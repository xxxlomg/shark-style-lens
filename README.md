# StyleLens

> 网页 UI 视觉逆向工程 Chrome 扩展（Manifest V3）

选中网页上任意 UI 元素，StyleLens 自动分析其 DOM / CSS / 布局 / 上下文，编译成可直接交给 AI 编程工具的 UI 复刻 Prompt（流式生成、浮空面板展示、一键复制）。

![icon](apps/extension/public/stylelens-icon.svg)

## 功能特性

- **元素分析**：快捷键 `Alt+Shift+S` 开始选择，深度提取目标元素的样式、布局、上下文关系
- **Prompt 编译**：将结构化分析编译为侧重视觉保真度的 UI 复刻 Prompt
- **流式输出**：SSE 流式生成 Prompt，浮空面板实时展示（缓冲 + rAF 批量渲染、自动滚动）
- **本地安全**：AI 请求只发给本地后端（`127.0.0.1:3001`），API Key 不进入浏览器端

## 仓库结构（pnpm workspace）

```text
apps/extension/     # Chrome MV3 扩展（background + content script + popup）
services/api/       # 本地后端（Hono + SSE），仅监听 127.0.0.1:3001
tests/              # e2e 测试与 fixtures（Playwright）
```

## 快速开始

前置要求：Node.js ≥ 22（内置 `--env-file-if-exists`）、pnpm ≥ 9。

```bash
pnpm install                                          # 安装全部 workspace 依赖
Copy-Item services/api/.env.example services/api/.env # PowerShell；填写 DeepSeek Key
pnpm --filter @stylelens/api dev                      # 启动本地后端 http://127.0.0.1:3001
pnpm --filter @stylelens/extension build              # 构建扩展并打包 ZIP
```

### 安装扩展（开发者模式）

1. 构建扩展：`pnpm --filter @stylelens/extension build`
2. 打开本地安装页：`http://127.0.0.1:3001`，下载 `stylelens.zip` 并解压到本地目录
3. 打开 `chrome://extensions`，开启「开发者模式」→「加载已解压的扩展程序」，选择解压目录
4. 按 `Alt+Shift+S` 开始元素选择

## AI 请求链路与安全模型

```
Chrome 扩展 (background)
   │  fetch → http://127.0.0.1:3001/api/prompt/stream   （仅本地）
   ▼
本地后端 services/api（持有 API Key）
   │  OpenAI 兼容 Chat Completions + SSE
   ▼
https://api.deepseek.com/chat/completions
```

- **Key 不落前端**：`DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 只配置在 `services/api/.env`，由本地后端调起 AI；扩展包（ZIP）内不含任何 Key 或 AI 服务地址。
- **仅本地约束**：manifest 的 `host_permissions` 仅 `http://127.0.0.1/*` 与 `http://localhost/*`；`ai-client` 另有白名单校验（`isLocalApiBase`），设置被篡改也会回退到默认本地地址。
- **最小权限**：manifest 仅申请 `activeTab` / `scripting` / `storage`；UI 挂载到 Shadow DOM，不污染宿主页面。
- **共享密钥**：扩展访问本地后端时携带 `STYLELENS_API_SECRET`（默认 `stylelens-dev`，可在扩展设置与 `.env` 中统一修改）。

### Provider 与模型参数

Provider 优先级：**DeepSeek → OpenAI GPT → mock**（按 Key 是否配置选择，调用失败不会自动降级）。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 本地后端端口（仅 127.0.0.1） |
| `STYLELENS_API_SECRET` | `stylelens-dev` | 扩展访问本地后端的共享密钥 |
| `DEEPSEEK_API_KEY` | 空 | 配置后优先使用 DeepSeek |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek 兼容端点 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek 模型名 |
| `OPENAI_API_KEY` | 空 | DeepSeek Key 未配置时的备用 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点 |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI 模型名 |

实际发送的请求体（OpenAI 兼容）：

- `model`：`deepseek-v4-flash`（或 `OPENAI_MODEL`）
- `stream: true`：开启 SSE 流式输出
- `thinking: { type: 'disabled' }`：**关闭思考模式（不输出思维链）**，与 `reasoning_effort: 'high'` 组合已验证可行
- `messages`：系统提示（UI 逆向专家指令）+ 用户消息（结构化分析 JSON）

## 请求诊断

若未生成 Prompt，打开 `chrome://extensions` → StyleLens → `Service worker` → `Inspect` 查看 background 控制台：

- `[StyleLens][API] request:start`：已向本地 API 发起请求
- `[StyleLens][API] request:response`：本地 API 已返回 HTTP 状态
- `[StyleLens][API] stream:complete`：Prompt 流式响应完成
- `[StyleLens][API] request:failed`：请求失败，错误信息含 trace id

本地后端终端同步打印 `[StyleLens API] prompt:received` → `prompt:provider-selected`（显示实际使用的 `deepseek` / `openai` / `mock`）→ `prompt:complete` 或 `prompt:error`。日志不输出 API Key、页面 DOM 或 Prompt 内容。

## 测试

```bash
pnpm --filter @stylelens/api test         # 后端单测（Vitest）：provider 请求体、鉴权、路由
pnpm --filter @stylelens/extension test   # 扩展单测（Vitest）：api-client 本地白名单等
pnpm --filter @stylelens/extension test:e2e  # Playwright e2e（脚本 `scripts` 子目录含 e2e 辅助）
pnpm --filter @stylelens/extension lint   # oxlint + prettier 检查
```

## 核心约束

- **后端仅本地**：扩展请求地址只允许 `localhost` / `127.0.0.1`，默认 `http://127.0.0.1:3001`，不指向公网。
- **API Key 不落前端**：Key 只存在于 `services/api/.env`；`docs/` 等内部文档不入库。
- **流式闭环**：分析 → 编译 → 流式生成 → 复制，全链路以 trace id 贯穿。