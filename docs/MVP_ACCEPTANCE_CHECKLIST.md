# StyleLens MVP 验收清单（§69）

> 对应产品文档 §69 v0.2 验收门槛。逐条核对，附证据来源（测试 / 实现文件）。
>
> 状态：**MVP 功能验收通过**（视觉重建评分属后续人工 benchmark，见 tests/benchmark/README.md）

## Product

| 门槛 | 结论 | 证据 |
|---|---|---|
| 用户 5 秒内理解如何开始 | ✅ | 官网介绍页 4 步流程（services/api/public/index.html）；Popup 一键 [Select Element]；快捷键 Alt+Shift+S |
| 点击错元素后可以立即重选 | ✅ | Re-select 按钮 + Esc 取消（selection.spec「Esc cancels selection; Re-select returns to selecting」） |
| 面板可以自由拖动 | ✅ | PromptPanel 拖拽（selection.spec「panel drags freely and persists position」；位置记忆 chrome.storage §58.3） |
| 面板不会破坏原网页布局 | ✅ | Shadow DOM 隔离（smoke.spec「without polluting the page」：宿主 body color 不变） |

## Analyzer

| 门槛 | 结论 | 证据 |
|---|---|---|
| 常见 Button/Card/Input/Navbar/Modal 可稳定分析 | ✅（Modal 未单测，见已知问题） | benchmark 矩阵 10 组件全通过（benchmark.spec，含 button/card/navbar/form/input/badge/tabs/search-bar/product-card/footer-section） |
| 能正确识别主要布局上下文 | ✅ | LayoutProfile.flex/grid + semanticDescription + outerLayoutContext（context.ts / layout.ts）；golden 含 flex 语义描述 |
| 能区分 computed fact 与 inference | ✅ | facts 数组仅 source ∈ computed/css-rule/inheritance/variable；inferences 独立数组带 evidence（profile-builder.ts；golden 断言） |
| CSS variable 可以被解释 | ✅ | cssom.ts CSSVariableUsage（name + resolvedValue）；visual.ts extractColorToken |

## AI

| 门槛 | 结论 | 证据 |
|---|---|---|
| Prompt 不只是 CSS dump | ✅ | Prompt Compiler 输出 §25 章节（Goal/Component Context/Layout/Typography/Colors & Surfaces/…），去噪 + 语义描述（prompt-compiler.spec「renders markdown with all §25 sections」「filters noise facts」） |
| Prompt 能说明布局、视觉和上下文 | ✅ | Layout/Typography/Colors & Surfaces/Component Context 章节由 StyleProfile 语义字段驱动 |
| Prompt 可直接复制到主流 coding model | ✅ | e2e 全链路复制验证（analysis.spec「streams a prompt end-to-end and copies it」：剪贴板内容 = Prompt） |

## Engineering

| 门槛 | 结论 | 证据 |
|---|---|---|
| Shadow DOM 隔离通过测试 | ✅ | smoke.spec + overlay 样式经 ?inline 注入 Shadow Root |
| Chrome MV3 lifecycle 正常 | ✅ | manifest 校验通过、SW 注册（e2e serviceWorkers 断言）；background onInstalled/onMessage |
| 无明显页面性能回归 | ✅ | benchmark 矩阵闭环 < 500ms/组件；hover 走 elementFromPoint + rAF（§38）；单测覆盖状态机 |
| 核心 analyzer 有 regression fixture | ✅ | golden/plain-html-button.golden.json + golden 对比测试（§67.3） |

## 已知问题 / 后续

- **Modal 未纳入 benchmark**：10 组件清单按 §42 精简版选取（T4 决策），Modal 属 Phase 4 扩展。
- **视觉重建评分未跑**：需 DEEPSEEK_API_KEY 或外部 AI 工具按 tests/benchmark/README.md 流程人工执行。
- **响应式多 viewport 采集**：属 V1.5+（§22），MVP 只记录当前 viewport。
- **品牌版 Chrome 自动化模式不加载扩展**：e2e 使用 Playwright Chromium；手动安装走官网拖拽按钮 + chrome://extensions。

## 验证命令

```bash
pnpm --filter @stylelens/extension test      # 27 unit
pnpm --filter @stylelens/api test            # 6 unit
pnpm --filter @stylelens/extension test:e2e  # 20 e2e（smoke/selection/analysis/benchmark/privacy）
pnpm --filter @stylelens/extension lint
```
