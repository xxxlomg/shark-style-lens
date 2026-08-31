import type {
  CompiledContext,
  PromptProvider,
  ProviderOptions,
  VisionRequest,
} from "./types";

const MOCK_CHUNK_SIZE = 256;

async function yieldMockChunk(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Mock Provider：未配置 DeepSeek Key 时仅用于本地测试。
 * 直接流式输出 Compiler 渲染的 markdown（本地闭环 / e2e 确定性），按句切块。
 */
export class MockProvider implements PromptProvider {
  async *stream(
    ctx: CompiledContext,
    _options: ProviderOptions,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const chunks = ctx.markdown.match(
      new RegExp(`[\\s\\S]{1,${MOCK_CHUNK_SIZE}}`, "g"),
    ) ?? [ctx.markdown];
    for (const chunk of chunks) {
      if (signal?.aborted) return;
      yield chunk;
      await yieldMockChunk();
    }
  }

  /** Deterministic structured fallback for local route and contract tests. */
  async *streamVision(
    req: VisionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const result = JSON.stringify({
      componentBoundary: {
        kind: "unknown",
        confidence: 0,
        evidence: [`mock received ${req.images.length} image(s)`],
      },
      visualGrouping: {
        relationships: [],
        confidence: 0,
        evidence: ["mock-no-visual-inspection"],
      },
      visualSemantics: [],
      stateChanges: [],
      consistencyChecks: [],
      appearance: {
        palette: [],
        surfaceTreatment: "mock did not inspect image content",
        appearanceDescription: "",
        subcomponents: [],
      },
      overallConfidence: 0,
      unknowns: [
        `mock provider did not inspect image content for this ${req.images.length}-image request`,
      ],
    });
    const chunks: string[] = [];
    for (let index = 0; index < result.length; index += MOCK_CHUNK_SIZE) {
      chunks.push(result.slice(index, index + MOCK_CHUNK_SIZE));
    }
    for (const chunk of chunks) {
      if (signal?.aborted) return;
      yield chunk;
      await yieldMockChunk();
    }
  }
}
