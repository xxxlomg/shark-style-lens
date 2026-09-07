import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { createSlotProvider } from "../providers/model-config";
import { getModelConfig, getVisionDispatch } from "../providers";
import { ProviderError } from "../providers/types";
import { parseVisionAnalysis } from "../providers/vision-analysis";
import { visionStreamRequestSchema } from "../schemas";

/** 视觉分析请求路径：与综合推理（/api/prompt/stream）分离，绑定视觉槽位调度 */
export const visionStreamRoute = new Hono();

visionStreamRoute.post("/stream", authMiddleware(), async (c) => {
  const traceId = c.req.header("x-trace-id")?.trim() || crypto.randomUUID();
  const startedAt = Date.now();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
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

  const parsed = visionStreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    console.warn("[StyleLens API] vision:invalid-payload", {
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

  const { task, images, imageDetail } = parsed.data;
  const config = getModelConfig();

  // cropPolicy 预算：单次视觉调用的图像数量上限
  if (images.length > config.visionDefaults.maxImagesPerCall) {
    return c.json(
      {
        error: {
          code: "E_TOO_MANY_IMAGES",
          message: `Vision slot allows at most ${config.visionDefaults.maxImagesPerCall} images per call`,
        },
      },
      400,
    );
  }

  const dispatch = getVisionDispatch();
  console.info("[StyleLens API] model:task-dispatched", {
    traceId,
    slot: dispatch.kind === "skip" ? undefined : dispatch.slot.role,
    task: "visual-evidence-analysis",
    source: dispatch.kind,
    provider: dispatch.kind === "skip" ? undefined : dispatch.slot.provider,
    model: dispatch.kind === "skip" ? undefined : dispatch.slot.model,
    execution:
      dispatch.kind === "skip"
        ? "skipped"
        : dispatch.slot.provider === "deepseek"
          ? "remote-api"
          : "local-mock",
    imageCount: images.length,
    imageDetail: imageDetail ?? config.visionDefaults.imageDetail,
  });

  // 降级：无可用视觉能力 → 显式返回，由调用方记录为 Unknown 证据
  if (dispatch.kind === "skip") {
    console.info("[StyleLens API] model:task-skipped", {
      traceId,
      task: "visual-evidence-analysis",
      reason: dispatch.reason,
    });
    return c.json({ available: false, reason: dispatch.reason, traceId }, 200);
  }

  const provider = createSlotProvider(dispatch.slot, { traceId });
  if (!provider.streamVision) {
    return c.json(
      {
        available: false,
        reason: `${dispatch.slot.label} does not implement streamVision`,
        traceId,
      },
      200,
    );
  }
  // 捕获到非空常量，避免闭包内 TS 对可选属性的收窄丢失
  const streamVision = provider.streamVision.bind(provider);

  const requestSignal = c.req.raw.signal;

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
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* 客户端已断开 */
        }
        return;
      }

      // source 区分专用视觉槽与委托路径，供基准评测关联
      send("vision_start", { source: dispatch.kind, traceId });
      try {
        let output = "";
        for await (const chunk of streamVision(
          {
            task,
            images,
            imageDetail: imageDetail ?? config.visionDefaults.imageDetail,
          },
          requestSignal,
        )) {
          output += chunk;
          send("vision_chunk", { text: chunk });
        }

        let analysis;
        try {
          analysis = parseVisionAnalysis(output);
        } catch (err) {
          throw new ProviderError(
            "E_PROVIDER_INVALID_OUTPUT",
            `Vision model returned invalid structured JSON: ${(err as Error)?.message ?? "parse failed"}`,
          );
        }

        if (!requestSignal.aborted) {
          send("vision_result", { source: dispatch.kind, analysis });
          send("vision_complete", { source: dispatch.kind, structured: true });
          console.info("[StyleLens API] vision:complete", {
            traceId,
            source: dispatch.kind,
            slot: dispatch.slot.role,
            model: dispatch.slot.model,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (err) {
        if (!requestSignal.aborted) {
          const code =
            err instanceof ProviderError ? err.code : "E_PROVIDER_STREAM_ERROR";
          console.error("[StyleLens API] vision:error", {
            traceId,
            code,
            slot: dispatch.slot.role,
            model: dispatch.slot.model,
            message: (err as Error)?.message ?? "Vision stream failed",
            durationMs: Date.now() - startedAt,
          });
          send("vision_error", {
            code,
            message: (err as Error)?.message ?? "Vision stream failed",
            recoverable: code !== "E_PROVIDER_INVALID_OUTPUT",
          });
        }
      } finally {
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
