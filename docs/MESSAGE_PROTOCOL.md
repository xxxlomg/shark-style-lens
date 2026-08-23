# MESSAGE_PROTOCOL.md —— Extension 消息与通信协议（v0.1）

> 配套文档 B（对应产品文档 §36 / §37 / §57 / §62 / §64 / §65）
>
> 版本：v0.1（MVP）
>
> 定位：定义 Content Script ↔ Background ↔ Popup ↔ services/api 之间**所有**消息的形状、流向、校验与错误语义。所有消息 payload 引用 `STYLE_PROFILE_SCHEMA.md` 的类型，并通过 Zod 校验（§62 / §71-7）。
>
> 已确认决策：services/api 采用 **Hono**；默认 Provider **DeepSeek（deepseek-chat）**；鉴权 = **共享密钥**（`Authorization: Bearer <shared-secret>`，密钥存服务端 env，不落前端）。

---

## 1. 角色与通道总览

```text
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│   Browser Page   │  DOM   │ Content Runtime  │  msg   │ Extension Runtime│
│   (host page)    │◄──────►│ (content script) │◄──────►│ (background SW)  │
└──────────────────┘ 事件   └──────────────────┘        └───────┬──────────┘
      ▲                                                         │ HTTP + SSE
      │  Shadow DOM overlay                                     │ (共享密钥鉴权)
      └──────────────┬──────────────────────────────────────────┘
                     ▼
            ┌──────────────────┐         ┌──────────────────┐
            │   Popup UI       │         │  services/api    │
            │  (settings/start)│◄───────►│  (Hono + SSE)    │
            └──────────────────┘  msg    └────────┬─────────┘
                                                  ▼
                                         Provider (DeepSeek …)
```

**四个架构边界**（§55.2）：

| 边界 | 职责 | 不允许 |
|---|---|---|
| Browser Page | 被分析对象 | — |
| Content Runtime | DOM/CSS 采集、选择、overlay UI | 持 API Key、管理长任务 |
| Extension Runtime | 消息路由、AI 请求编排、storage、流式转发 | 直接分析 DOM |
| AI / Backend | LLM 调用、Provider 抽象、流式返回 | 接收原始页面 HTML/敏感数据 |

**核心原则**：分析引擎不依赖 React；UI 不直接理解 DOM 原始细节；**API Key 永不进入 Extension 任何一端**（§36）。

> **MVP 硬约束（用户提出）**：插件访问的服务端地址**必须为本地 localhost** —— `http://127.0.0.1:<port>`（默认端口 3001）。MVP 不指向任何公网/远程服务器；`apiBaseUrl` 设置只允许 localhost 范围。对应 manifest `host_permissions` 仅含 `http://127.0.0.1/*` 与 `http://localhost/*`（见 MVP_TASK_BACKLOG 任务 1.3）。

---

## 2. 消息封装规范

所有 Extension 内部消息统一形状：

```ts
interface Envelope<T> {
  /** 请求方生成的 trace id，用于关联分析→生成的整条链路 */
  traceId: string
  /** 目标 tab id（background 转发需要） */
  tabId?: number
  type: string
  payload: T
  /** ISO 时间戳 */
  ts: string
}
```

校验规则：

1. 每个消息类型有独立 Zod schema（`src/shared/schemas/messages.ts`）。
2. 接收方必须 `safeParse`；解析失败时回复 `ANALYSIS_ERROR { code: "E_INVALID_PAYLOAD" }`，**不静默忽略**。
3. `traceId` 由发起方生成，贯穿 Content → Background → services/api（作为请求头 `X-Trace-Id` 透传），用于日志关联与排障。

---

## 3. 通道 A：Content ↔ Background（`chrome.runtime.sendMessage` / `onMessage`）

### 3.1 消息全集（§62，MVP）

```ts
type ExtensionMessage =
  | { type: "SELECTION_START" }                       // Popup/快捷键 → Content：进入选择模式
  | { type: "ELEMENT_SELECTED"; payload: SelectedElement }  // Content → Background/UI：目标已锁定
  | { type: "ANALYSIS_START"; payload: AnalysisRequest }    // UI → Content：开始分析
  | { type: "ANALYSIS_PROGRESS"; payload: AnalysisProgress }// Content → UI：分析阶段进度
  | { type: "STYLE_PROFILE_READY"; payload: StyleProfile }  // Content → Background：分析完成
  | { type: "PROMPT_START" }                          // Background → Content：LLM 请求已发出
  | { type: "PROMPT_CHUNK"; payload: { text: string } }     // Background → Content：增量文本
  | { type: "PROMPT_COMPLETE" }                       // Background → Content：流结束
  | { type: "PROMPT_CANCEL" }                         // Content → Background：中止当前流（Re-select / Esc / 新分析）
  | { type: "ANALYSIS_ERROR"; payload: ErrorPayload }       // 任一方向：失败
```

> 取消语义：用户在流式期间 Re-select / 取消 / 发起新分析，Content 发送 `PROMPT_CANCEL`；Background 用 AbortController 中止对应 tab 的 SSE 请求，后续 chunk 不再转发，旧流终止事件静默丢弃（不触发错误 UI）。UI 侧同时重置分析状态（面板与 Prompt 无残留）。

### 3.2 Payload 类型

```ts
// 引用 STYLE_PROFILE_SCHEMA.md：SelectedElement 使用 TargetInfo 的 uid/selector/rect 子集
interface SelectedElement {
  uid: string
  tagName: string
  selector: string
  rect: Rect
  classes: string[]
  scope: "element" | "component"   // 用户选择的「当前元素」还是「这个组件」（§5）
}

interface AnalysisRequest {
  targetUid: string
  scope: "element" | "component"    // MVP 支持两者；「这个区域」为 V1.5+（§5）
  options?: AnalysisOptions
}

interface AnalysisOptions {
  maxAncestorDepth?: number   // 默认 6（§59.2）
  maxChildren?: number        // 默认 8
  includePseudoElements?: boolean  // 默认 true（§16 为 V1 能力）
}

interface AnalysisProgress {
  phase:
    | "preparing"
    | "inspecting-structure"
    | "understanding-layout"
    | "collecting-styles"
    | "building-profile"
  progress: number            // 0–100
}

// 引用 STYLE_PROFILE_SCHEMA.md 的 StyleProfile 类型
// STYLE_PROFILE_READY.payload = StyleProfile

interface ErrorPayload {
  code: ErrorCode             // 见 §7 错误码表
  message: string
  recoverable: boolean        // true = UI 提供 Retry 按钮
  detail?: string
}
```

### 3.3 消息时序（正常流）

```text
Content                    Background                 UI(Zustand store)
   │                            │                          │
   │◄──── SELECTION_START ──────│◄──── SELECTION_START ────│  (Popup/快捷键)
   │  (进入 selecting 态)        │                          │
   │                            │                          │
   │── ELEMENT_SELECTED ───────►│── ELEMENT_SELECTED ─────►│  (锁定 + 控制 UI)
   │                            │                          │
   │◄──── ANALYSIS_START ───────│◄──── ANALYSIS_START ─────│  (用户点 Analyze)
   │  (deep analysis 开始)       │                          │
   │── ANALYSIS_PROGRESS ──────►│── ANALYSIS_PROGRESS ────►│  (多阶段进度)
   │── STYLE_PROFILE_READY ────►│                          │
   │                            │── POST /api/prompt/stream│  (见 §5)
   │◄──── PROMPT_START ─────────│                          │
   │◄──── PROMPT_CHUNK × N ─────│                          │  (流式渲染)
   │◄──── PROMPT_COMPLETE ──────│                          │  (启用 Copy)
```

> 实现备注：`ELEMENT_SELECTED` 之后，Analysis 状态完全由 Content 侧持有；Background 只做路由与 AI 请求。UI 状态（SelectionState / AnalysisState / OverlayState，§61）存在 Content 侧 Zustand store，不依赖 Background 内存（MV3 SW 非长驻，§57.2）。

---

## 4. 通道 B：Popup ↔ Background

Popup 不是核心分析界面（§34 / §57.3），MVP 只承载：

```ts
type PopupMessage =
  | { type: "SELECTION_START" }                          // 点击 [Select Element]
  | { type: "GET_SETTINGS" }                             // 读取设置
  | { type: "SET_SETTINGS"; payload: SettingsPayload }   // 写设置
  | { type: "GET_RECENT"; payload: { limit: number } }   // 最近分析（V1 占位，返回空数组）

interface SettingsPayload {
  provider?: string          // 默认 "deepseek"
  model?: string             // 默认 "deepseek-chat"
  baseUrl?: string           // 默认 "https://api.deepseek.com"（provider 侧，服务端 env 优先）
  apiBaseUrl?: string        // 默认 "http://127.0.0.1:3001"；硬约束：仅允许 localhost 范围
  language?: "en"            // T5 已确认：MVP 固定英文，不做中文切换
  detail?: "compact" | "balanced" | "detailed"
  shortcut?: string          // 显示用（实际快捷键在 manifest commands）
}
```

---

## 5. 通道 C：Background ↔ services/api（HTTP + SSE）

### 5.1 端点

**Base URL（MVP 硬约束）**：`http://127.0.0.1:3001`（默认端口 3001，可在设置 `apiBaseUrl` 调整；**仅允许 localhost 范围，禁止公网/远程地址**）。

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/health` | 存活探测（返回 `{ status: "ok", provider: "deepseek" }`） |
| `POST` | `/api/prompt/stream` | 生成 Prompt（SSE 流式） |

### 5.2 鉴权（已确认 T3）

```text
Authorization: Bearer <shared-secret>
X-Trace-Id: <traceId>          // 透传链路 id
Content-Type: application/json
```

- 共享密钥由 services/api 服务端 env 配置（如 `STYLELENS_API_SECRET`）。
- 缺失/错误密钥 → `401`（`{ code: "E_AUTH_FAILED" }`）。
- Extension 侧将密钥保存在**服务端**，Extension 中不存任何秘密；MVP 的共享密钥属于部署配置（本地开发自行生成），未来升级为账户鉴权（§33 future authentication）。

### 5.3 请求体（`POST /api/prompt/stream`）

```ts
// 引用 STYLE_PROFILE_SCHEMA.md
interface PromptStreamRequest {
  profile: StyleProfile      // Zod 校验（失败 → 400 E_INVALID_PAYLOAD）
  options?: PromptOptions    // 默认 { targetFramework: "agnostic", language: "en", detail: "balanced" }
}
```

校验失败响应（400）：

```json
{ "error": { "code": "E_INVALID_PAYLOAD", "message": "StyleProfile failed Zod validation", "detail": "<zod error path list>" } }
```

### 5.4 响应：SSE 事件流

`Content-Type: text/event-stream`，事件命名规范：

```text
event: prompt_start
data: {}

event: prompt_chunk
data: {"text":"Recreate this UI component as closely as possible..."}

event: prompt_chunk
data: {"text":" to the observed result."}

event: prompt_complete
data: {"promptId":"p_<uuid>"}

event: prompt_error
data: {"code":"E_PROVIDER_RATE_LIMIT","message":"...","recoverable":true}
```

事件约定：

1. `prompt_chunk` 的 `text` 为**纯增量**（append 语义，不包含前序内容）。
2. `prompt_complete` 为终止事件，之后服务端必须关闭连接；客户端收到后停止渲染并启用 Copy。
3. `prompt_error` 可在流中任意时刻出现（如 provider 中途失败），出现后同样终止。
4. 心跳：服务端每 15s 发送 `event: ping`（注释行 `:ping` 亦可），客户端据此判定连接存活。
5. 流式消费链路（§64）：`fetch() → ReadableStream → background relay → PROMPT_CHUNK message → Zustand update → PromptViewer append`；渲染侧用 buffer + `requestAnimationFrame` 批量更新，避免每 token 触发 reflow（§37）。

### 5.5 非流式错误（HTTP 状态）

| 状态 | 错误码 | 含义 |
|---|---|---|
| 400 | `E_INVALID_PAYLOAD` | 请求体 Zod 校验失败 |
| 401 | `E_AUTH_FAILED` | 共享密钥缺失/错误 |
| 429 | `E_RATE_LIMIT` | 服务端限流（含 provider 限流透传） |
| 5xx | `E_BACKEND_ERROR` | 服务端内部错误（provider 不可达等） |

---

## 6. Storage keys 规范（§31）

命名空间 `stylelens.`，仅 `chrome.storage.local`（非敏感）与 `chrome.storage.session`（会话态，MV3 专用）：

| Key | 范围 | 内容 | 说明 |
|---|---|---|---|
| `stylelens.settings` | local | SettingsPayload | 用户设置 |
| `stylelens.panelPosition` | local | `{ x, y, userMoved }` | 面板最后位置（§58.3） |
| `stylelens.history` | local | `PromptRecord[]` | 最近分析（V1 占位，MVP 只写不读） |
| `stylelens.session` | session | 临时会话态（如当前 traceId、进行中的请求句柄） | SW 重启后允许丢失，UI 从 Content 侧恢复 |

```ts
interface PromptRecord {
  promptId: string
  traceId: string
  prompt: string
  profileVersion: string
  targetSelector?: string
  createdAt: string
}
```

> **禁止**在 storage 中存放 API Key、完整页面 HTML、未脱敏文本。

---

## 7. 错误码表（ErrorCode）

| 码 | 场景 | recoverable | 说明 |
|---|---|---|---|
| `E_SELECT_NO_TARGET` | SELECTION_START 时无活动 tab | false | 提示用户先打开网页 |
| `E_ANALYZE_TIMEOUT` | 分析超时（默认 5s） | true | Retry |
| `E_PROFILE_BUILD_FAILED` | StyleProfile 构建失败 | true | Retry |
| `E_ELEMENT_DETACHED` | 目标元素在分析中从 DOM 移除 | true | 提示重选（边界情况 10） |
| `E_INVALID_PAYLOAD` | 消息/请求体 Zod 校验失败 | false | 属内部 bug，记录 traceId |
| `E_BACKEND_UNAVAILABLE` | services/api 不可达（网络/未启动） | true | 提示检查后端 |
| `E_AUTH_FAILED` | 共享密钥错误 | false | 提示检查服务端配置 |
| `E_SSE_DISCONNECT` | 流中断连 | true | 提示已生成部分内容，可 Retry |
| `E_PROVIDER_AUTH` | provider（DeepSeek）密钥无效 | false | 提示检查服务端 env |
| `E_PROVIDER_RATE_LIMIT` | provider 限流 | true | 建议稍后重试 |
| `E_PROVIDER_TIMEOUT` | provider 首 token 超时 | true | Retry |
| `E_PROVIDER_STREAM_ERROR` | 流中途异常 | true | Retry |
| `E_CSSOM_RESTRICTED` | 跨域 CSSOM 不可读 | **false（降级）** | 非错误：走降级链后作为 warning 上报（§41），Prompt 正常生成 |

**降级链**（§41）：完整 CSSOM → Computed Style → Layout + DOM → 仍然输出 Prompt。`CROSS_ORIGIN_CSSOM` 等降级情况写入 StyleProfile.warnings（info/warning 级别），**不中断**主流程；只有 `error` 级别才走 `ANALYSIS_ERROR`。

---

## 8. 数据脱敏边界（§39 / §65.2）

**永不进入任何消息/请求**（硬性禁止，写单测）：

```text
- password / input[type=password] 的值
- 任何 input / textarea 的 value（含搜索框）
- cookie、localStorage、sessionStorage 内容
- Authorization token / API Key
- 完整页面 HTML 或无关页面文本
- 跨域 iframe 内容（§20）
```

**文本字段处理规则**（§7）：限长（默认 120 字符）；邮箱/电话号码正则过滤；URL 中 query token 过滤；`aria-label` 按需脱敏。脱敏在 Content Script 采集层完成（`src/content/analyzer/privacy.ts`），StyleProfile 中的文本字段均为脱敏后值。

**发送分层**（§65.2）：

```text
Raw Page Data → Normalization → Sensitive Data Filter → Prompt Context → Model API
```

---

## 9. 时序图：完整 MVP 闭环（§53 / §36）

```text
用户浏览网页
  │  Alt+Shift+S / Popup [Select Element]
  ▼
SELECTION_START ──► Content: selecting mode
  │  hover (elementFromPoint + rect, <16ms)
  │  click → ELEMENT_SELECTED
  ▼
UI: Selected [Analyze] [Re-select] [Component]
  │  Analyze → ANALYSIS_START
  ▼
Content: DOM/CSS/Layout/Context 采集 → ANALYSIS_PROGRESS × N
  ▼
StyleProfile 构建（Zod safeParse）→ STYLE_PROFILE_READY
  ▼
Background: POST /api/prompt/stream（SSE）
  ▼
PROMPT_START → PROMPT_CHUNK × N → PROMPT_COMPLETE
  ▼
面板流式展示（自动滚动，用户上滚停止跟随）→ [Copy Prompt]
```

---

## 10. 与配套文档的关系

| 文档 | 关系 |
|---|---|
| `STYLE_PROFILE_SCHEMA.md` | 本协议所有 payload 的类型与 Zod 来源（`StyleProfile`、`Rect`、`PromptOptions` 等） |
| `MVP_TASK_BACKLOG.md` | Sprint 3 落地 Schema 与采集；Sprint 4 的 `services/api` 任务按 §5 实现契约；错误码表是 Sprint 4 UI 错误态的实现依据 |
| 产品文档 | §36 通讯模型、§62 消息全集、§64 流式 UI、§65 隐私为本协议的上位要求 |

## 11. 变更规则

1. 新增消息类型 = 向后兼容（Consumer 需容忍未知类型并记录 warning）。
2. 修改已有消息的 payload 形状 = minor 版本升级，同步更新 Zod schema 与两端实现；**禁止静默改字段语义**。
3. 新增错误码 = 兼容；删除错误码 = 先废弃再移除。
4. 任何变更必须同步更新本文件、STYLE_PROFILE_SCHEMA.md 与 golden/e2e 测试。

---

*本文件由任务 0.3 产出。实现顺序：Sprint 1 先落地 `messages.ts` 骨架（类型 + Zod + 空路由），Sprint 4 落地 services/api 契约。*
