# StyleLens（Style → Prompt）MVP 任务计划书

> 状态：待实施
>
> 目标：从零搭建 StyleLens Chrome 扩展（MV3）。本阶段先产出三份工程规格文档（STYLE_PROFILE_SCHEMA / MESSAGE_PROTOCOL / MVP_TASK_BACKLOG），随后按 5 个 Sprint 实现 `Select → Analyze → Stream → Copy` 的 MVP 闭环，并以 10 组件 benchmark 验收视觉复刻质量。
>
> 依据：`docs/style_to_prompt_product_architecture_roadmap.md`（v0.2，3231 行，下文简称「产品文档」），章节引用均指向该文档。
>
> 已确认决策（与用户沟通结论）：① 交付物 = 任务计划书 + 三份配套文档，本阶段不写业务代码；② AI 链路 = Node 后端服务（services/api），Key 不落前端；③ 工程结构 = 先单 app（apps/extension），预留 packages 边界；extension 与 services/api 以**最小 pnpm workspace** 连接（共享 schema 类型所需），不预建 `packages/*`；④ 验收基准 = 10 个真实组件起步；⑤ 默认 AI Provider = DeepSeek（OpenAI 兼容协议）。
>
> 补充确认（待确认事项 T1–T9 全部拍板）：
> ⑥ services/api 框架 = **Hono**；⑦ 默认模型 = **deepseek-chat**；⑧ Key 管理 = **服务端 env 存储 + 共享密钥鉴权**（MESSAGE_PROTOCOL 需定义鉴权请求头）；
> ⑨ benchmark 站点 = 自建 fixtures 为主 + 真实网站抽查（T4 认可）；⑩ Prompt 输出 = **默认英文、MVP 不做中文**（T5）；⑪ Lint = **保留 oxlint + Prettier**（T6）；⑫ 最近分析历史 = **MVP 不做**（T7）；⑬ 产品名 = **StyleLens 确定**（T8）；⑭ 官网介绍页 = **简单介绍页 + 拖拽安装按钮**（T9，见任务 1.9）；
> ⑮ **硬约束（用户提出）：插件访问的服务端地址必须为本地 localhost（`http://127.0.0.1:<port>`，默认 3001），MVP 不指向任何公网/远程服务器**；对应 manifest `host_permissions` 仅含 localhost 范围（§40）。

---

## 1. 计划概述

### 背景

- 产品文档 v0.2 已完成，定义了一个完整的「网页 UI 视觉逆向工程」Chrome 扩展：用户点选网页元素 → 分析 DOM/CSS/Layout/Context → 生成核心数据资产 **StyleProfile** → Prompt Compiler → LLM 流式生成 → 浮空面板展示 → 复制给 AI 编程工具。
- 仓库 `F:\code\ai\shark\shark-style-lens` 当前仅是一个全新的 Vite 8 + React 19 + TS 6 脚手架，**没有任何扩展代码**。
- 产品文档 §72 明确：进入工程实现前，应先产出三份配套文档（STYLE_PROFILE_SCHEMA / MESSAGE_PROTOCOL / MVP_TASK_BACKLOG），把「产品设计」正式转换为「工程实现」的输入。

### 目标（可度量）

1. **本阶段（阶段 0）交付**：任务计划书（本文档）+ 三份配套文档，均可评审、可直接指导编码。
2. **MVP 目标（阶段 1–4）**：
   - 完整闭环：选择 → 分析 → 流式生成 → 复制，无需 Side Panel / DevTools。
   - StyleProfile 满足 §60 首版结构，Facts 与 Inferences 严格分离（§2.4 / §60.1）。
   - 性能预算达标（§66）：selection highlight < 16ms 级、basic snapshot < 100ms、StyleProfile build < 500ms（常规组件）。
   - 10 组件 benchmark 通过（§42 清单精简版，见任务 0.4）。
3. **验收门槛**：产品文档 §69 的 v0.2 验收门槛（Product / Analyzer / AI / Engineering 四类）。

### 预期结果（可观察）

- 在真实网页（含自建 fixtures）上点选任意组件，浮空面板流式输出可直接粘贴到 Cursor / Claude Code / ChatGPT / Gemini 的高质量 UI 复刻 Prompt。
- 生成 Prompt 重建出的 UI 与原始组件视觉相似度达到可辨识水平（benchmark 打分量化为后续 Phase 4 的 North Star 指标）。
- 插件对宿主页面零样式污染（Shadow DOM 隔离，§30 / §58）。

### 非目标（防止范围蔓延）

- **不做** Side Panel / DevTools 专业模式（V1 / V2，§35）。
- **不做** 多浏览器支持（仅 Chrome MV3，§55.1）。
- **不做** 用户账户、计费、鉴权体系（MVP 后端可无鉴权或最小共享密钥，见待确认事项）。
- **不做** 历史 / 收藏 / Prompt Library（V2，§35.5）。
- **不做** Responsive 多 viewport 采集与 State Capture（V1.5+，§22 / §50 Phase 5）。
- **不做** Phase 2 深水区中的 CSSOM 源码还原、组件库识别（Material / Ant Design 等，§70.4）。
- **不做** Chrome 商店上架流程（发布属后续独立任务）。
- **不做** 资源文件下载 / 重建（Asset 第一版仅描述，§18）。

---

## 2. 现状与差距

### 当前实现/状态（已实际探查）

| 对象 | 现状证据 |
|---|---|
| `package.json` | name=`demo`；deps 仅 react/react-dom 19；devDeps：vite 8、@vitejs/plugin-react、typescript ~6、oxlint、@types/*；**无** Vitest / Playwright / Tailwind / Zustand / Zod / ESLint / Prettier |
| `vite.config.ts` | 仅 `react()` 插件，无多入口、无 MV3 构建配置 |
| `src/` | 模板 demo（`App.tsx` / `main.tsx` / `index.css` / `App.css`），无任何扩展代码 |
| `README.md` | Vite 模板说明，未更新 |
| `docs/` | 仅产品文档 v0.2，无 schema / 协议 / backlog |
| 工程链 | oxlint 已配置（`.oxlintrc.json`）；无 Prettier、无测试框架、无 lint-staged |

### 与目标的差距

- **全部从零**：无 Manifest V3、无 Content Script、无 Background SW、无 Shadow DOM UI、无分析引擎、无后端服务。
- **技术栈迁移**：产品文档 §55.1 选型表（Tailwind CSS 4 / shadcn/ui / Zustand / Zod / Vitest / Playwright / pnpm）与当前脚手架几乎全部不符，需要在 Sprint 1 引入。
- **规格缺失**：StyleProfile 数据结构、消息协议、任务 backlog 均未落成文档，无法直接进入编码。
- **为什么现在做**：产品设计已定稿（v0.2），文档 §72 明确下一步即工程化；当前无任何代码资产需要兼容，是建立正确工程基线的唯一窗口期。

---

## 3. 影响范围分析

### 直接影响（本阶段 = 阶段 0）

| 对象 | 影响原因 |
|---|---|
| `docs/stylelens_mvp_task_plan.md` | **新增**：本任务计划书 |
| `docs/STYLE_PROFILE_SCHEMA.md` | **新增**：任务 0.2 产出 |
| `docs/MESSAGE_PROTOCOL.md` | **新增**：任务 0.3 产出 |
| `docs/MVP_TASK_BACKLOG.md` | **新增**：任务 0.4 产出 |

### 间接影响

| 对象 | 引用关系说明 |
|---|---|
| `docs/style_to_prompt_product_architecture_roadmap.md` | 三份配套文档的唯一输入源，被引用但**不改动** |
| 根脚手架（`src/`、`package.json`、`vite.config.ts`） | 阶段 0 只读引用其现状；Sprint 1 将把脚手架迁移至 `apps/extension/` 并重构（属后续执行阶段） |
| 未来新增的 `services/api` | 由 MESSAGE_PROTOCOL 定义其 HTTP + SSE 契约，本阶段只写契约不建服务 |

### 边界约束

- **允许修改**：`docs/` 下新增文件（本计划 + 3 份配套文档）。
- **仅可引用**：产品文档（只读）；当前脚手架配置（只读，作为 Sprint 1 迁移的现状输入）。
- **禁止访问/修改**：`src/`、`package.json`、`vite.config.ts`、`.oxlintrc.json`、`node_modules/`（本阶段一律不动）；**不安装任何新依赖**。
- **未来阶段约束（写入计划，供 Sprint 1 遵守）**：产品文档 §71 的 10 条工程原则（Vite+React+TS 基础、Tailwind/shadcn 仅服务插件 UI、Shadow DOM 隔离、Analyzer 与 React 解耦、StyleProfile 为核心协议、Facts/Inferences 分离、消息协议类型化 + Zod、MVP 不依赖 Side Panel、框架不可知、能力建立在 StyleProfile 之上）。

---

## 4. 方案与取舍

### 4.1 三份配套文档的产出方式

- 方案 A（一次三份）：按依赖链 SCHEMA → PROTOCOL → BACKLOG 连续产出，一次交付评审。
- 方案 B（逐份评审）：每份文档产出后先评审再写下一份。
- **推荐 A**：三份文档依赖关系强（PROTOCOL 引用 SCHEMA 的 payload，BACKLOG 引用前两者），连续产出上下文连贯、成本低；评审集中在一次进行。

### 4.2 StyleProfile 首版结构

- 方案 A（§60 首版结构）：`version/target/context/structure/layout/spacing/typography/visual/assets/responsive/states/facts/inferences/warnings` 14 个顶层字段。
- 方案 B（§23 完整版）：含 `domTree/matchedRules/inheritedStyles/cssVariables/borders/shadows/diagnostics` 等更细字段。
- **推荐 A**：§60 是文档明确的「推荐首版结构」，字段已覆盖 MVP 闭环所需；§23 的细字段（matchedRules、inheritedStyles 等）在 Phase 2（Style Intelligence）再扩展，避免首版过度设计。SCHEMA 文档中需标注 Phase 2 扩展位。

### 4.3 后端服务框架（services/api）

- 方案 A：**Hono** —— 轻量、TypeScript 原生、SSE 支持好、无框架重。
- 方案 B：Express —— 生态最大，但 TS/流式支持需更多样板。
- 方案 C：Next.js —— 文档提及，但 MVP 只需一个流式转发 + provider 抽象，引入全栈框架过重。
- **已确认：方案 A（Hono）**：MVP 后端职责单一（§24 链路中仅 LLM 调用 + 流式转发），Hono 在体积、SSE、类型体验上最合适；若未来需要 Web 端页面再评估 Next.js。

### 4.4 流式通道

- 方案 A：SSE（`text/event-stream`）—— 与 DeepSeek 的 OpenAI 兼容流式协议天然匹配，服务端实现简单，Content Script 端 `fetch` + `ReadableStream` 即可消费。
- 方案 B：fetch streaming（NDJSON）—— 同样可行，但需要自定义分帧。
- **推荐 A（SSE）**：产品文档 §37 将 SSE 列为首选，且与 provider 流协议对齐。

### 4.5 Lint 工具

- 方案 A：保留 oxlint（已配置）+ 新增 Prettier。
- 方案 B：切换 ESLint（产品文档 §44 提及）。
- **推荐 A**：oxlint 是 ESLint 的即插即用加速替代，现有配置已生效，避免双 linter 冲突；如后续需要 ESLint 生态插件再评估迁移。**（见待确认事项 T6）**

### 4.6 LLM 调用位置与 Provider 抽象（已确认）

- 已确认：Node 后端转发（Key 不落前端，§36 第一版原则）；鉴权 = 共享密钥（服务端 env 校验 `Authorization: Bearer <shared-secret>`，T3）。
- 结构：`PromptProvider` 接口（`stream(compiledContext, options): AsyncIterable<string>`）→ `DeepSeekProvider`（OpenAI 兼容 `chat/completions` + SSE，默认模型 `deepseek-chat`，T2）为 MVP 默认实现；模型名 / base URL 可配置。
- 目标：后续新增 Anthropic / OpenAI / Gemini Provider 时，后端只加实现类，Extension 与 UI 零改动（§70.1）。

---

## 5. 详细任务列表

> 任务分两组：**阶段 0 任务（本次执行）** 为完整拆分；**阶段 1–4 任务（后续执行）** 按 Sprint 汇总（目标/依赖/验收），每项任务的 objective/files/acceptance/test cases/dependencies 明细由任务 0.4 产出的 `MVP_TASK_BACKLOG.md` 承载。

### 阶段 0 —— 工程规格（本次执行）

#### 任务 0.1：产出本任务计划书（本文档）

- 目标：形成可评审、可执行、可验收的 MVP 总计划，收敛决策与待确认事项。
- 步骤：1. 通读产品文档全文并摘录关键章节 → 2. 探查仓库现状 → 3. 与用户确认 5 项关键决策 → 4. 按本模板成文。
- 涉及文件：`docs/stylelens_mvp_task_plan.md`（新增）。
- 依赖：无。
- 验收标准：含目标/非目标、现状证据、影响范围、任务列表、测试计划、风险、待确认事项、结论；每条影响结论可追溯到实际文件。

#### 任务 0.2：产出 `STYLE_PROFILE_SCHEMA.md`

- 目标：定义 StyleProfile 完整 TypeScript + Zod Schema（产品文档 §72 配套文档 A），作为全系统的核心数据协议。
- 步骤：
  1. 依据 §60 定义 14 个顶层字段及 `StyleFact` / `Inference` / `AnalysisWarning` 类型（§60.1 强制 Facts/Inferences 分离）。
  2. 定义子 Profile 类型：`TargetInfo`（§7 DOMNodeSnapshot）、`ContextInfo`（§59.3 ComponentInference + Outer Layout Context）、`StructureProfile`、`LayoutProfile`（§11 Flex/Grid/Position）、`SpacingProfile`（§12 Box Model）、`TypographyProfile`（§13）、`VisualProfile`（§14–15 Color/Surface/Border/Shadow + §16 Pseudo 元素）、`AssetProfile`（§18）、`ResponsiveProfile`（§22）、`StateProfile`（§17）、`CSSVariableUsage`（§10）。
  3. 为每个接口编写 Zod schema（§62 要求所有 payload 通过 Zod 校验）。
  4. 编写 1 个完整示例（Button 组件）的 StyleProfile JSON，作为文档与未来 golden fixture 的参照。
  5. 标注 Phase 2 扩展位（matchedRules / inheritedStyles / diagnostics 等，§23），明确首版不含。
- 涉及文件：`docs/STYLE_PROFILE_SCHEMA.md`（新增）。
- 依赖：无（直接基于产品文档）。
- 验收标准：覆盖 §60 全部 14 个顶层字段；Facts/Inferences 分离；每个接口有 Zod schema；含 Button 完整示例；与产品文档 §7/§10/§13/§14/§59/§60 字段交叉核对一致。

#### 任务 0.3：产出 `MESSAGE_PROTOCOL.md`

- 目标：定义 Content ↔ Background ↔ Popup ↔ services/api 的全部消息与流式契约（产品文档 §72 配套文档 B）。
- 步骤：
  1. 定义 Extension 内部消息全集（§62）：`SELECTION_START` / `ELEMENT_SELECTED` / `ANALYSIS_START` / `ANALYSIS_PROGRESS` / `STYLE_PROFILE_READY` / `PROMPT_START` / `PROMPT_CHUNK` / `PROMPT_COMPLETE` / `ANALYSIS_ERROR`，每个 payload 引用任务 0.2 的 Zod schema。
  2. 定义 Background ↔ services/api 契约：`POST /api/prompt/stream`（请求头 = `Authorization: Bearer <shared-secret>`，T3；请求体 = StyleProfile + PromptOptions：目标框架/语言/长度档位），响应 = SSE 事件流（`prompt_start` / `prompt_chunk` / `prompt_complete` / `prompt_error`）。
  3. 定义 Popup ↔ Background 消息（start selection、settings 读写、recent analysis 占位）。
  4. 定义 storage keys 规范（settings / panel position / prompt history 占位，§31）。
  5. 定义错误码表（含跨域 CSSOM 降级、iframe 不可达、provider 错误、流中断重试策略，§41）。
  6. 定义通信时序图（§36）与数据脱敏边界（§39 / §65.2：哪些字段永不进入请求）。
- 涉及文件：`docs/MESSAGE_PROTOCOL.md`（新增）。
- 依赖：任务 0.2（payload 引用 StyleProfile schema）。
- 验收标准：§62 全部消息类型覆盖且 payload 有类型 + Zod；SSE 事件格式明确（含示例帧）；错误码表完整；脱敏规则明确（password/input value/auth token 永不发送）。

#### 任务 0.4：产出 `MVP_TASK_BACKLOG.md`

- 目标：把 Sprint 1–5 拆成可直接交给 Cursor / Claude Code 执行的任务（产品文档 §72 配套文档 C），并固化 10 组件 benchmark 与 golden fixtures 规范。
- 步骤：
  1. 按 §68 五个 Sprint 拆分任务，每项含：objective / files / acceptance criteria / test cases / dependencies。
  2. Sprint 1 包含仓库重构任务：脚手架迁移至 `apps/extension/`（单 app，预留 packages 边界）、MV3 manifest、Vite 多入口、Content Script 注入、Background SW、Shadow DOM overlay、Tailwind CSS 4 + shadcn/ui 接入（含 shadow DOM 隔离预研）、Vitest/Playwright/Prettier 落地。
  3. Sprint 5 定义 10 组件 benchmark 清单（从 §42 选取）：Button / Card / Navbar / Form / Input / Badge / Tabs / Search Bar / Product Card / Footer Section。
  4. 定义 fixtures 目录（§67.2）：`plain-html / tailwind / flex-card / grid-layout / nested-component / dark-theme / responsive / shadow-dom / iframe`，及 Golden StyleProfile 回归机制（§67.3）。
  5. 为每个 Sprint 写清退出标准（对应 §69 验收门槛）。
- 涉及文件：`docs/MVP_TASK_BACKLOG.md`（新增）。
- 依赖：任务 0.2、任务 0.3（backlog 中任务引用两份协议）。
- 验收标准：5 个 Sprint 全覆盖；每任务五要素齐全；10 组件清单确定；fixtures 目录结构确定；§69 验收门槛逐条可追踪到 Sprint 退出标准。

### 阶段 1–4 —— MVP 实现（后续执行，明细见 MVP_TASK_BACKLOG.md）

#### Sprint 1：Extension Skeleton

- 目标：跑通 MV3 最小扩展 + Shadow DOM 浮层 + 工程链（§68 Sprint 1）。
- 关键内容：仓库重构（apps/extension 单 app）、manifest（activeTab/scripting/storage + **localhost 范围 host_permissions**，§40 最小权限，硬约束 ⑮）、Vite 多入口、Content Script 注入、Background SW、React overlay 挂 Shadow Root、Tailwind 4 + shadcn/ui、Vitest/Playwright 就绪、**官网介绍页 + 拖拽安装按钮（任务 1.9，T9）**。
- 依赖：任务 0.4（backlog）。
- 验收标准：`pnpm dev` 可加载未打包扩展并在任意页面注入 overlay；Shadow DOM 隔离通过测试；`pnpm test` / `pnpm build` / `pnpm lint` 全绿。

#### Sprint 2：Selection

- 目标：hover 高亮 → 点击锁定 → Esc/Enter → re-select → 拖拽（§68 Sprint 2）。
- 关键内容：`elementFromPoint` 选择引擎（§59.1）、hover overlay（§4.1）、点击锁定控制 UI（§4.2）、面板拖拽与位置记忆（§2.1.1 / §58.3）、UI 状态机（§47）。
- 依赖：Sprint 1。
- 验收标准：选择 < 16ms 级交互；点错可立即重选不刷新页面；面板拖拽自由、位置记忆生效；状态机 IDLE→SELECTING→SELECTED→…→ERROR 全通路。

#### Sprint 3：StyleProfile

- 目标：DOM/CSS/Layout/Context 采集并构建 StyleProfile（§68 Sprint 3）。
- 关键内容：DOM snapshot（§7）、computed style 提取（§8.1）、CSSOM 规则溯源（§8.2，跨域容错）、继承分析（§9）、CSS 变量提取（§10）、Layout 语义化（§11）、Box Model（§12）、Typography（§13）、Color/Surface（§14）、Border/Shadow（§15）、Pseudo 元素（§16，V1 能力）、Shadow DOM / iframe 探测（§19–20）、Theme/Responsive 上下文（§21–22）、Component Boundary 推断（§6 / §59.3）、数据脱敏（§7 文本规则 / §39）、性能预算（§66）。
- 依赖：Sprint 2。
- 验收标准：对 fixtures 内 Button/Card 等生成完整 StyleProfile；Facts/Inferences 分离；CSSOM 跨域降级不失败；脱敏规则单测通过；profile build < 500ms。

#### Sprint 4：Prompt

- 目标：StyleProfile → Prompt Compiler → 后端流式 → 面板展示 → 复制（§68 Sprint 4）。
- 关键内容：`services/api`（Hono + SSE + DeepSeek Provider，§4.3/§4.6）、Prompt Compiler（§24.1 / §63.1 去噪/排序/摘要）、流式 UI（§28 / §64 缓冲 + rAF 批量更新、自动滚动、用户上滚停止跟随）、Copy（§64.2 `navigator.clipboard`）、错误/重试（§41）。
- 依赖：Sprint 3。
- 验收标准：选择 → 分析 → 流式 → 复制全闭环（§68 Sprint 4 交付物）；首字节尽快出现；Prompt 非 CSS dump，含结构/布局/视觉/上下文（§69 AI 类验收）。

#### Sprint 5：Quality

- 目标：benchmark 与回归体系（§68 Sprint 5）。
- 关键内容：10 组件 benchmark 评测（任务 0.4 清单）、golden fixtures + Golden StyleProfile 回归、Playwright e2e、性能 profiling（§66）、隐私过滤加固（§65.2）、20 真实组件抽查按 10 起步执行。
- 依赖：Sprint 4。
- 验收标准：§69 v0.2 验收门槛四类全部满足；10/10 组件可生成可用 Prompt；无页面性能明显回归；核心 analyzer 有回归 fixture。

---

## 6. 测试与验证计划

### 测试策略（分四层）

| 层 | 工具 | 覆盖对象 | 落地时机 |
|---|---|---|---|
| 单元 | Vitest | CSS normalization、box model 计算、component boundary 推断、StyleProfile builder、Prompt Compiler、消息 schema（§67.1） | Sprint 3–4 |
| 浏览器集成 | Playwright + fixtures | selection 正确性、overlay 不污染页面、drag 稳定性、prompt 完整性、copy 成功（§67.2） | Sprint 5 |
| Golden 回归 | Vitest snapshot | 固定 fixture 的预期 StyleProfile，防 Analyzer 重构后 silently regress（§67.3） | Sprint 3 起 |
| 手工验证 | 真实网站 | 10 组件 benchmark 抽取的真实站点抽查；SSE 断连/重试体验 | Sprint 4–5 |

### 验证命令（Sprint 1 落地后生效）

```text
pnpm lint          # oxlint + Prettier check
pnpm test          # Vitest 单元 + golden 回归
pnpm build         # tsc -b && vite build（MV3 产物）
pnpm test:e2e      # Playwright（fixtures 场景）
pnpm dev           # 本地加载扩展手工验证
```

### 回归范围

- **shared 协议/schema 变更** → content / background / popup / services-api 全部回归（MESSAGE_PROTOCOL + STYLE_PROFILE_SCHEMA 为契约层）。
- **StyleProfile schema 变更** → Analyzer、Prompt Compiler、UI 展示、golden fixtures 回归。
- **Provider 变更** → 仅 services/api 内回归（Provider 抽象边界内）。

---

## 7. 风险评估

### 高风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 跨域 stylesheet 的 CSSOM 访问受限（§8.2） | 规则溯源信息缺失，影响 Prompt 质量 | §41 分层降级已内置（完整 CSSOM → computed → layout+DOM 仍输出）；fixtures 覆盖跨域场景；SCHEMA/PROTOCOL 中定义 `warnings` 上报 |
| MV3 Service Worker 非长驻、内存不保（§57.2） | 会话状态丢失导致流式中断 | 状态设计约束：关键状态放 chrome.storage 或 Content/UI 内存；流式由 Content 侧持有，SW 只做转发 |
| Shadow DOM × Tailwind CSS 4 隔离实现复杂度 | 插件 UI 样式异常或污染宿主 | Sprint 1 单列预研任务：Tailwind 4 产物注入 Shadow Root 的策略（独立 CSS 入口 + shadow 相关配置），先出最小验证再铺开 |

### 中风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| DeepSeek 流式兼容 / 限流 / 超时 | Prompt 生成失败或体验差 | Provider 抽象内实现重试与超时；MESSAGE_PROTOCOL 定义 `prompt_error` + 前端 retry；模型名/base URL 可配置 |
| 复杂组件（Navbar/Modal）边界推断不准 | Prompt 上下文偏差，复刻效果差 | Boundary 推断为证据驱动（§59.3，输出 confidence + evidence）；benchmark 迭代修正规则；Phase 2 再强化 |
| 分析性能（CSSOM 遍历 / mousemove 计算） | 页面卡顿（§38/§66 禁止项） | hover 只做 `elementFromPoint` + rect；点击后才 deep analysis；children 超阈值截断；stylesheet 缓存；性能预算写入 Sprint 5 验收 |
| 隐私脱敏遗漏（§39/§65.2） | 敏感数据外泄 | 脱敏清单（password/input value/token 永不发送）+ 单测覆盖；发送链路分层（Raw → Normalize → Filter → Context） |

### 低风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 动态页面（SPA 重渲染）导致选中元素失效 | 分析结果与当前页面不一致 | 快照时机贴近点击瞬间；如元素 detached，warnings 提示用户重选（边界情况 10） |
| 面板拖出视口 / resize | 面板不可达 | 初次定位 viewport clamp（§58.3）；拖拽边界约束 |

### 未覆盖情况

| 情况 | 原因 | 建议处理 |
|---|---|---|
| Chrome 商店审核（隐私政策 / 权限说明 / 上架材料） | 属发布流程，非 MVP 开发范围 | 单独立项；Manifest 最小权限（§40）已为审核留好基础 |
| Firefox / Edge 适配 | 产品文档定 Chrome MV3 | Phase 后续评估（`browser.*` 兼容层） |
| 多账号 / 计费 / 用量限制 | MVP 无账户体系 | services/api 预留 auth 扩展位（§33 future authentication） |
| 大规模 Responsive 多 viewport 采集 | 属于 V1.5+（§22） | ResponsiveProfile 首版只记当前 viewport + 命中 media query |
| Side Panel / DevTools 专业模式 | 属 V1/V2（§35） | 非目标，明确不做 |

---

## 8. 边界情况

1. **Cross-origin iframe 中的目标元素**
   - 触发条件：用户点击嵌入的跨域 iframe 内容。
   - 当前处理：识别 iframe，提示「内容来自嵌入页面」，不强行分析（§20）。
   - 建议：MVP 即内置；跨 frame 协调协议留 Phase 2。
2. **Closed Shadow DOM / 第三方 Web Component**
   - 触发条件：`getRootNode()` 返回 closed shadow root。
   - 当前处理：记录边界，内部结构分析失败时友好提示，不中断整体分析（§19）。
   - 建议：warnings 字段承载降级信息。
3. **页面无 CSS 变量 / 无样式 / 纯文本页面**
   - 触发条件：任意裸 HTML 页面。
   - 当前处理：cssVariables / theme 为空数组，StyleProfile 仍完整生成。
   - 建议：作为 fixtures 之一（plain-html）纳入 golden 回归。
4. **用户选择 `body` / `html` 根节点**
   - 触发条件：hover 至最外层。
   - 当前处理：允许选择，但 Component Boundary 推断会收敛为页面级上下文并提示范围过大。
   - 建议：可考虑提示用户改用「这个组件」范围。
5. **超大页面 / 深层 DOM**
   - 触发条件：长列表页、深层嵌套。
   - 当前处理：DOM Context Window 限深 + children 截断（§59.2）；只分析必要 ancestor/sibling/child（§38）。
   - 建议：截断阈值写入 STYLE_PROFILE_SCHEMA 与性能预算。
6. **流式中用户再次选择 / 取消**
   - 触发条件：面板 streaming 时用户 Re-select。
   - 当前处理：UI 状态机允许 COMPLETED/ERROR → SELECTING（§47）；新选择须中止旧流（AbortController + SSE 取消）。
   - 建议：MESSAGE_PROTOCOL 定义 `PROMPT_CANCEL` 语义（或复用 ANALYSIS_START 隐含取消）。
7. **API Key 缺失 / 无效 / 后端不可达**
   - 触发条件：未配置 Key、Key 过期、服务宕机。
   - 当前处理：`prompt_error` 消息 + 面板错误态 + retry（§41 降级链）。
   - 建议：错误文案区分「配置缺失」与「服务失败」。
8. **SSE 断连 / 网络抖动**
   - 触发条件：流中网络中断。
   - 当前处理：Provider 层重试（幂等重建请求）；前端提示已生成部分内容。
   - 建议：重试策略写入 MESSAGE_PROTOCOL 错误码表。
9. **拖拽后窗口 resize / 视口变化**
   - 触发条件：面板处于 Floating 态时窗口缩放。
   - 当前处理：Floating 保留用户位置，仅做视口 clamp（§58.3）。
   - 建议：无需额外处理。
10. **SPA 重渲染导致目标元素 detached**
    - 触发条件：点击分析与渲染间隙页面更新。
    - 当前处理：快照在点击后立即执行；detached 时 warnings 提示重选。
    - 建议：低概率，MVP 提示重选即可。

---

## 9. 分阶段实施

| 阶段 | 目标 | 边界（阶段结束可验证/可交付） |
|---|---|---|
| **阶段 0（本次）** | 工程规格定稿 | 本计划书 + 3 份配套文档，可评审、可交给任何编码 Agent 执行 |
| **阶段 1（Sprint 1–2）** | 无 AI 的交互闭环 | MV3 扩展可加载；选择/拖拽/面板全可用；无任何 LLM 依赖 |
| **阶段 2（Sprint 3）** | StyleProfile 采集 | 对 fixtures 生成完整 StyleProfile（控制台/调试视图可验证）；golden 回归起步 |
| **阶段 3（Sprint 4）** | Prompt 全链路 | services/api + 流式面板 + 复制闭环；DeepSeek 默认 provider |
| **阶段 4（Sprint 5）** | 质量达标 | 10 组件 benchmark 通过；§69 验收门槛满足 |
| **阶段 5（后续路线）** | Phase 2–5（§50） | Style Intelligence、Prompt Quality、评测体系、高级能力；另含 Side Panel（V1）与 DevTools（V2） |

---

## 10. 待确认事项

- [x] **T1 services/api 框架**：**已确认 Hono**（备选 Express / Next.js，§4.3）。
- [x] **T2 DeepSeek 默认模型**：**已确认 `deepseek-chat`**（通用，首 token 快）；base URL 默认 `https://api.deepseek.com`，可配置。
- [x] **T3 Key 管理与访问控制**：**已确认** Key 存 services/api 服务端 env；MVP 采用共享密钥鉴权（`Authorization: Bearer`，服务端 env 配置），MESSAGE_PROTOCOL 已含请求头设计。
- [x] **T4 benchmark 站点来源**：**已确认** 自建 fixtures 为主（可复现、可回归）+ 真实网站抽查为辅。
- [x] **T5 Prompt 输出语言**：**已确认** 默认英文，MVP 不做中文切换（PromptOptions.language 固定 "en"）。
- [x] **T6 Lint 工具**：**已确认** 保留 oxlint + Prettier，不切换 ESLint。
- [x] **T7 历史记录**：**已确认** MVP 不含最近分析记录，V1 Side Panel 再做。
- [x] **T8 产品名**：**已确认 StyleLens**（manifest 名称、面板标题、文档命名统一）。
- [x] **T9 本地开发加载方式**：**已确认** 简单方案 = 官网介绍页（本地 `http://127.0.0.1:3001`）+ 页面内**拖拽安装按钮**（拖到 chrome://extensions 自动安装，受 Chrome 策略限制时降级为「下载 zip + Load unpacked」图文步骤），不做复杂 watch 重载工具（见 MVP_TASK_BACKLOG 任务 1.9）。

---

## 11. 计划结论

**推荐路线**：先执行阶段 0（本次）——按 0.2 → 0.3 → 0.4 顺序产出三份配套文档（依赖链：SCHEMA 定义数据 → PROTOCOL 定义通信 → BACKLOG 定义执行），待 T1–T9 收敛后进入阶段 1。实现期严格按 Sprint 1→5 顺序推进：先把无 AI 的「选得准、拖得动」做扎实（Sprint 1–2），再做 StyleProfile 采集（Sprint 3），随后接后端流式闭环（Sprint 4），最后以 10 组件 benchmark 收敛质量（Sprint 5）。全程遵守产品文档 §71 十原则：StyleProfile 是核心资产、Facts/Inferences 分离、协议第一天类型化 + Zod、Shadow DOM 隔离、框架不可知。

**主要风险提示**：① 跨域 CSSOM 限制会长期影响规则溯源质量，必须靠 §41 分层降级与 fixtures 持续验证；② Shadow DOM × Tailwind 4 的隔离是 Sprint 1 的预研难点，应最先攻破；③ 复杂组件的边界推断决定 Prompt 质量上限，benchmark 必须证据驱动地迭代，而不是一次成型；④ MV3 Service Worker 的状态约束从第一天就写入架构，避免后期返工。
