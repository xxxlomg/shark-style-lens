/** Provider 抽象（§70.1 / §44 AI 层）：模型无关，Extension 与 UI 不感知具体 provider */

export interface CompiledContext {
  /** 渲染成人类可读的 markdown（mock / 调试用） */
  markdown: string;
  /** 结构化数据（真实 LLM 的 user 输入） */
  data: unknown;
  /** Original labeled crops, only populated when the selected Agent slot supports vision. */
  imageInputs?: PromptImage[];
}

export interface PromptImage {
  kind: "target" | "context";
  dataUrl: string;
  width: number;
  height: number;
  coordinateSpace: "viewport-css";
  crop: {
    kind: "target" | "context";
    coordinateSpace: "viewport-css";
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface VisionImage {
  kind: "target" | "context";
  dataUrl: string;
  width: number;
  height: number;
  coordinateSpace: "viewport-css";
  crop: PromptImage["crop"];
}

export interface ProviderOptions {
  targetFramework?:
    "agnostic" | "react" | "vue" | "html-css" | "tailwind" | "nextjs";
  language?: "en";
  detail?: "compact" | "balanced" | "detailed";
}

/** §45 视觉请求契约：images 为 base64 data URL，仅允许发往具备视觉能力的槽位 */
export interface VisionRequest {
  task: string;
  /** Legacy string inputs remain accepted; labeled image objects are preferred. */
  images: Array<string | VisionImage>;
  imageDetail?: "low" | "high" | "original" | "auto";
}

export interface PromptStreamChunk {
  kind: "content" | "reasoning";
  text: string;
}

export interface PromptProvider {
  /** 流式返回 Prompt 增量文本 */
  stream(
    ctx: CompiledContext,
    options: ProviderOptions,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
  /** Optional richer stream used to relay DeepSeek reasoning_content to the UI. */
  streamWithReasoning?(
    ctx: CompiledContext,
    options: ProviderOptions,
    signal?: AbortSignal,
  ): AsyncIterable<PromptStreamChunk>;
  /** 视觉槽多模态调用（结构化结果可由上游一次性返回） */
  streamVision?(
    req: VisionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
}

export class ProviderError extends Error {
  constructor(
    public code:
      | "E_PROVIDER_AUTH"
      | "E_PROVIDER_RATE_LIMIT"
      | "E_PROVIDER_TIMEOUT"
      | "E_PROVIDER_STREAM_ERROR"
      | "E_PROVIDER_INVALID_OUTPUT",
    message: string,
  ) {
    super(message);
  }
}
