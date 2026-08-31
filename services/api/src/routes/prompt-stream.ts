import { Hono } from "hono";
import { compilePromptContext } from "../compiler/prompt-compiler";
import type { LightProfile } from "../compiler/types";
import { authMiddleware } from "../middleware/auth";
import { createSlotProvider, getModelConfig } from "../providers";
import { MockProvider } from "../providers/mock";
import {
  ProviderError,
  type CompiledContext,
  type PromptProvider,
  type PromptStreamChunk,
  type ProviderOptions,
} from "../providers/types";
import { findSensitivePayload, promptStreamRequestSchema } from "../schemas";

export const promptStreamRoute = new Hono();

async function* providerStream(
  provider: PromptProvider,
  compiled: CompiledContext,
  options: ProviderOptions,
  signal: AbortSignal,
): AsyncIterable<PromptStreamChunk> {
  if (provider.streamWithReasoning) {
    yield* provider.streamWithReasoning(compiled, options, signal);
    return;
  }
  for await (const text of provider.stream(compiled, options, signal)) {
    yield { kind: "content", text };
  }
}

promptStreamRoute.post("/stream", authMiddleware(), async (c) => {
  const traceId = c.req.header("x-trace-id")?.trim() || crypto.randomUUID();
  const startedAt = Date.now();
  console.info("[StyleLens API] prompt:received", {
    traceId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    console.warn("[StyleLens API] prompt:invalid-json", { traceId });
    return c.json(
      {
        error: {
          code: "E_INVALID_PAYLOAD",
          message: "Request body must be JSON",
        },
      },
      400,
    );
  }

  const parsed = promptStreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    console.warn("[StyleLens API] prompt:invalid-payload", {
      traceId,
      detail: parsed.error.issues.map((i) => i.path.join(".")).join(", "),
    });
    return c.json(
      {
        error: {
          code: "E_INVALID_PAYLOAD",
          message: "Request body failed validation",
          detail: parsed.error.issues.map((i) => i.path.join(".")).join(", "),
        },
      },
      400,
    );
  }

  const { profile, options, images } = parsed.data;
  const sensitivePath = findSensitivePayload(profile);
  if (sensitivePath) {
    console.warn("[StyleLens API] prompt:sensitive-payload", {
      traceId,
      path: sensitivePath,
    });
    return c.json(
      {
        error: {
          code: "E_SENSITIVE_PAYLOAD",
          message: "Payload contains prohibited sensitive data",
        },
      },
      400,
    );
  }
  const compiledBase = compilePromptContext(
    profile as unknown as LightProfile,
    options ?? {},
  );
  const modelConfig = getModelConfig();
  const templateMode = modelConfig.analysisMode === "template";
  const agentSlot = modelConfig.agent;
  const provider = templateMode
    ? new MockProvider()
    : createSlotProvider(agentSlot, { traceId });
  const providerName = templateMode ? "template" : agentSlot.provider;
  const providerModel = templateMode ? "deterministic-template" : agentSlot.model;
  const agentImages =
    modelConfig.analysisMode === "multimodal" && agentSlot.capabilities.vision
      ? images
      : undefined;
  const compiled = {
    ...compiledBase,
    imageInputs: agentImages,
    data: {
      ...(compiledBase.data as Record<string, unknown>),
      imageHandoff: {
        available: Boolean(images?.length),
        deliveredToAgent: Boolean(agentImages?.length),
        crops: (images ?? []).map(({ dataUrl: _dataUrl, ...image }) => image),
        limitation: agentImages?.length
          ? undefined
          : images?.length
            ? "The selected Agent slot is text-only; image crops were retained as metadata but not sent to the model."
            : "No screenshot crops were supplied.",
      },
    },
  };
  const requestSignal = c.req.raw.signal;

  console.info("[StyleLens API] model:task-dispatched", {
    traceId,
    slot: agentSlot.role,
    task: "reconstruction-synthesis",
    provider: providerName,
    model: providerModel,
    execution: templateMode
      ? "local-template"
      : providerName === "deepseek"
        ? "remote-api"
        : "local-mock",
    target: profile.target.tagName,
    factCount: profile.facts.length,
    imageCount: agentImages?.length ?? 0,
  });

  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("connection", "keep-alive");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          /* 客户端已断开 */
        }
      };
      const ping = setInterval(() => send("ping", {}), 15_000);

      if (requestSignal.aborted) {
        console.info("[StyleLens API] prompt:aborted-before-stream", {
          traceId,
        });
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* 客户端已断开 */
        }
        return;
      }

      send("prompt_start", {});
      console.info("[StyleLens API] prompt:upstream-start", {
        traceId,
        slot: agentSlot.role,
        model: providerModel,
        provider: providerName,
      });
      try {
        let reasoningChunkCount = 0;
        let contentChunkCount = 0;
        for await (const chunk of providerStream(
          provider,
          compiled,
          options ?? {},
          requestSignal,
        )) {
          if (chunk.kind === "reasoning") {
            reasoningChunkCount += 1;
            send("prompt_reasoning_chunk", { text: chunk.text });
          } else {
            if (chunk.text) contentChunkCount += 1;
            send("prompt_chunk", { text: chunk.text });
          }
        }
        if (!requestSignal.aborted) {
          if (contentChunkCount === 0) {
            throw new ProviderError(
              "E_PROVIDER_INVALID_OUTPUT",
              "Agent returned reasoning but no reconstruction prompt content",
            );
          }
          send("prompt_complete", { promptId: crypto.randomUUID() });
          console.info("[StyleLens API] prompt:complete", {
            traceId,
            slot: agentSlot.role,
            model: providerModel,
            provider: providerName,
            durationMs: Date.now() - startedAt,
            reasoningChunkCount,
          });
        }
      } catch (err) {
        if (!requestSignal.aborted) {
          const code =
            err instanceof ProviderError ? err.code : "E_PROVIDER_STREAM_ERROR";
          console.error("[StyleLens API] prompt:error", {
            traceId,
            slot: agentSlot.role,
            model: providerModel,
            provider: providerName,
            code,
            message: (err as Error)?.message ?? "Stream failed",
            durationMs: Date.now() - startedAt,
          });
          send("prompt_error", {
            code,
            message: (err as Error)?.message ?? "Stream failed",
            recoverable: code !== "E_PROVIDER_INVALID_OUTPUT",
          });
        }
      } finally {
        if (requestSignal.aborted) {
          console.info("[StyleLens API] prompt:aborted", {
            traceId,
            slot: agentSlot.role,
            model: providerModel,
            provider: providerName,
            durationMs: Date.now() - startedAt,
          });
        }
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* 客户端已断开 */
        }
      }
    },
  });

  return c.body(stream);
});
