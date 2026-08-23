# StyleLens

> 项目代号：StyleLens —— 网页 UI 视觉逆向工程 Chrome 扩展（Manifest V3）

选中网页上任意 UI 元素，插件自动分析其 DOM / CSS / 布局 / 上下文，编译成可直接交给 AI 编程工具的 UI 复刻 Prompt（流式生成、浮空面板展示）。

## 仓库结构（pnpm workspace）

```text
apps/extension/     # Chrome MV3 扩展（单 app，预留 packages 边界）
services/api/       # 本地后端服务（Hono + SSE），仅监听 127.0.0.1
tests/              # e2e 与 fixtures（Playwright）
docs/               # 产品文档 + 三份配套工程规格
```

## 快速开始

```bash
pnpm install                 # 安装全部 workspace 依赖
pnpm --filter @stylelens/extension build    # 构建扩展到 apps/extension/dist
pnpm --filter @stylelens/api dev            # 启动本地后端（http://127.0.0.1:3001）
```

### 安装扩展（开发模式）

1. 构建扩展：`pnpm --filter @stylelens/extension build`
2. 打开 `chrome://extensions` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `apps/extension/dist`
4. 快捷键 `Alt+Shift+S` 开始元素选择

官网介绍页（含拖拽安装按钮）由本地后端托管：`http://127.0.0.1:3001`

## 工程规格（配套文档）

| 文档 | 内容 |
|---|---|
| `docs/style_to_prompt_product_architecture_roadmap.md` | 产品文档 v0.2（需求与技术架构） |
| `docs/stylelens_mvp_task_plan.md` | MVP 总任务计划书 |
| `docs/STYLE_PROFILE_SCHEMA.md` | StyleProfile 数据协议（TS + Zod） |
| `docs/MESSAGE_PROTOCOL.md` | 消息与通信协议（含 SSE 契约） |
| `docs/MVP_TASK_BACKLOG.md` | Sprint 1–5 可执行任务清单 |

## 核心约束

- **后端仅本地**：插件访问的服务端地址必须为 localhost（`http://127.0.0.1:3001`），不指向公网/远程服务器。
- **API Key 不落前端**：DeepSeek Key 存于 services/api 服务端 env；Extension 通过共享密钥访问本地后端。
- **最小权限**：manifest 仅申请 `activeTab` / `scripting` / `storage` 与 localhost 范围 host_permissions。
- **Shadow DOM 隔离**：插件 UI 挂载到独立 Shadow Root，不污染宿主页面。
