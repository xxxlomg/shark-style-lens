import {
  ProviderError,
  type CompiledContext,
  type PromptProvider,
  type PromptStreamChunk,
  type ProviderOptions,
  type VisionImage,
  type VisionRequest,
} from "./types";
import { SYSTEM_PROMPT } from "./system-prompt";

interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  label: string;
  firstTokenTimeoutMs?: number;
  extraBody?: Record<string, unknown>;
  visionExtraBody?: Record<string, unknown>;
  visionPrompt?: string;
  /** 槽位级参数：仅在显式配置时注入请求体 */
  temperature?: number;
  /** Timeout for non-streaming completions, such as the Vision prerequisite. */
  completionTimeoutMs?: number;
  /** Request correlation metadata. Never include credentials, prompts, or image data. */
  logContext?: {
    traceId?: string;
    slot?: "agent" | "vision";
  };
}

type ModelOperation = "reconstruction-synthesis" | "visual-evidence-analysis";

interface ModelRequestDetails {
  operation: ModelOperation;
  imageCount?: number;
}

function agentPayload(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (!("evidencePack" in record)) return data;
  const sections = Array.isArray(record.sections)
    ? record.sections
        .map((section) =>
          section && typeof section === "object"
            ? (section as Record<string, unknown>).title
            : undefined,
        )
        .filter((title): title is string => typeof title === "string")
    : [];
  return {
    evidencePack: record.evidencePack,
    outputContract: sections,
    imageHandoff: record.imageHandoff,
  };
}

/** Shared streaming implementation for providers exposing Chat Completions. */
export class OpenAICompatibleProvider implements PromptProvider {
  private readonly firstTokenTimeoutMs: number;
  private readonly completionTimeoutMs: number;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.firstTokenTimeoutMs = config.firstTokenTimeoutMs ?? 30_000;
    this.completionTimeoutMs = config.completionTimeoutMs ?? 120_000;
  }

  async *stream(
    ctx: CompiledContext,
    _options: ProviderOptions,
    requestSignal?: AbortSignal,
  ): AsyncIterable<string> {
    for await (const chunk of this.streamWithReasoning(
      ctx,
      _options,
      requestSignal,
    )) {
      if (chunk.kind === "content") yield chunk.text;
    }
  }

  async *streamWithReasoning(
    ctx: CompiledContext,
    _options: ProviderOptions,
    requestSignal?: AbortSignal,
  ): AsyncIterable<PromptStreamChunk> {
    const payload = agentPayload(ctx.data);
    const userContent = ctx.imageInputs?.length
      ? [
          { type: "text", text: JSON.stringify(payload) },
          ...ctx.imageInputs.flatMap((image, index) => [
            {
              type: "text",
              text: `Attached image ${index + 1}: ${image.kind} crop. Use imageHandoff metadata to map it to CSS coordinates.`,
            },
            {
              type: "image_url",
              image_url: { url: image.dataUrl, detail: "high" },
            },
          ]),
        ]
      : JSON.stringify(payload);
    yield* this.streamMessages(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      requestSignal,
      this.config.extraBody,
      { operation: "reconstruction-synthesis" },
    );
  }

  /** DeepSeek vision call: user text + image_url content parts. */
  async *streamVision(
    req: VisionRequest,
    requestSignal?: AbortSignal,
  ): AsyncIterable<string> {
    const imageParts = req.images.flatMap((image, index) => {
      if (typeof image === "string") {
        return [
          {
            type: "text",
            text: `Image ${index + 1}: unlabeled legacy crop with unknown coordinate space. Do not use it to override browser geometry or infer target/context relationships.`,
          },
          {
            type: "image_url",
            image_url: { url: image, detail: req.imageDetail ?? "auto" },
          },
        ];
      }
      return [
        {
          type: "text",
          text: imageLabel(image, index),
        },
        {
          type: "image_url",
          image_url: {
            url: image.dataUrl,
            detail: req.imageDetail ?? "auto",
          },
        },
      ];
    });
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: this.config.visionPrompt
          ? `${this.config.visionPrompt}\n\n${req.task}`
          : req.task,
      },
      ...imageParts,
    ];
    // Vision is a structured prerequisite for synthesis. DeepSeek's Vision
    // guide documents Chat Completions as a regular JSON response, so avoid
    // keeping the orchestration pipeline dependent on an upstream SSE stream.
    const output = await this.completeMessages(
      [{ role: "user", content }],
      requestSignal,
      this.config.visionExtraBody ?? this.config.extraBody,
      { operation: "visual-evidence-analysis", imageCount: req.images.length },
    );
    if (output) yield output;
  }

  private async completeMessages(
    messages: Array<Record<string, unknown>>,
    requestSignal: AbortSignal | undefined,
    extraBody: Record<string, unknown> | undefined,
    details: ModelRequestDetails,
  ): Promise<string | undefined> {
    const controller = new AbortController();
    let timedOut = false;
    const deadline = Date.now() + this.completionTimeoutMs;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.completionTimeoutMs);
    const abortFromRequest = () => controller.abort();
    if (requestSignal?.aborted) {
      clearTimeout(timeout);
      return;
    }
    requestSignal?.addEventListener("abort", abortFromRequest, { once: true });

    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const endpoint = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    const logFields = {
      traceId: this.config.logContext?.traceId,
      slot: this.config.logContext?.slot,
      operation: details.operation,
      provider: this.config.label,
      model: this.config.model,
      endpoint,
      ...(details.imageCount === undefined
        ? {}
        : { imageCount: details.imageCount }),
    };

    try {
      console.info("[StyleLens API] model:request-sent", logFields);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          ...extraBody,
          ...(this.config.temperature !== undefined
            ? { temperature: this.config.temperature }
            : {}),
          stream: false,
        }),
        signal: controller.signal,
      });

      console.info("[StyleLens API] model:response-received", {
        ...logFields,
        status: response.status,
      });
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          "E_PROVIDER_AUTH",
          `Invalid ${this.config.label} API key (check server env)`,
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          "E_PROVIDER_RATE_LIMIT",
          `${this.config.label} rate limit exceeded`,
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          "E_PROVIDER_STREAM_ERROR",
          `${this.config.label} responded ${response.status}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      console.info("[StyleLens API] model:response-content-type", {
        ...logFields,
        contentType,
        contentLength: response.headers.get("content-length"),
      });
      console.info("[StyleLens API] model:response-body-read-start", logFields);
      const bodyTimeoutError = () => {
        timedOut = true;
        console.error("[StyleLens API] model:response-body-timeout", {
          ...logFields,
          timeoutMs: this.completionTimeoutMs,
        });
        controller.abort();
        return new ProviderError(
          "E_PROVIDER_TIMEOUT",
          `${this.config.label} response body timed out`,
        );
      };
      const body = contentType.toLowerCase().includes("text/event-stream")
        ? await readSseBody(response, deadline, bodyTimeoutError)
        : await readJsonBody(response, deadline, bodyTimeoutError);
      console.info("[StyleLens API] model:response-body-read-complete", {
        ...logFields,
        bodyLength: body.length,
      });

      const content = parseCompletionContent(body, contentType);
      if (!content) {
        throw new ProviderError(
          "E_PROVIDER_INVALID_OUTPUT",
          `${this.config.label} returned no assistant content`,
        );
      }
      console.info("[StyleLens API] model:response-complete", logFields);
      return content;
    } catch (err) {
      if (requestSignal?.aborted) return;
      console.error("[StyleLens API] model:request-failed", {
        ...logFields,
        error: (err as Error)?.message ?? "request failed",
      });
      if (err instanceof ProviderError) throw err;
      if (timedOut || (err as Error)?.name === "AbortError") {
        throw new ProviderError(
          "E_PROVIDER_TIMEOUT",
          `${this.config.label} request timed out`,
        );
      }
      throw new ProviderError(
        "E_PROVIDER_STREAM_ERROR",
        `${this.config.label} request failed: ${(err as Error)?.message ?? "unknown error"}`,
      );
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  }

  private async *streamMessages(
    messages: Array<Record<string, unknown>>,
    requestSignal?: AbortSignal,
    extraBody = this.config.extraBody,
    details: ModelRequestDetails = { operation: "reconstruction-synthesis" },
  ): AsyncIterable<PromptStreamChunk> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    const abortFromRequest = () => controller.abort();
    if (requestSignal?.aborted) return;
    requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const endpoint = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    const logFields = {
      traceId: this.config.logContext?.traceId,
      slot: this.config.logContext?.slot,
      operation: details.operation,
      provider: this.config.label,
      model: this.config.model,
      endpoint,
      ...(details.imageCount === undefined
        ? {}
        : { imageCount: details.imageCount }),
    };
    let firstTokenTimer: ReturnType<typeof setTimeout> | undefined;
    let response: Response;
    try {
      console.info("[StyleLens API] model:request-sent", logFields);
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          ...extraBody,
          ...(this.config.temperature !== undefined
            ? { temperature: this.config.temperature }
            : {}),
          // The local API relays provider output over SSE to the extension.
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
      if (requestSignal?.aborted) return;
      console.error("[StyleLens API] model:request-failed", {
        ...logFields,
        error: (err as Error)?.message ?? "request failed",
      });
      if ((err as Error)?.name === "AbortError") {
        throw new ProviderError(
          "E_PROVIDER_TIMEOUT",
          `${this.config.label} request timed out`,
        );
      }
      throw new ProviderError(
        "E_PROVIDER_STREAM_ERROR",
        `${this.config.label} request failed: ${(err as Error)?.message}`,
      );
    }
    try {
      console.info("[StyleLens API] model:response-received", {
        ...logFields,
        status: response.status,
      });
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          "E_PROVIDER_AUTH",
          `Invalid ${this.config.label} API key (check server env)`,
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          "E_PROVIDER_RATE_LIMIT",
          `${this.config.label} rate limit exceeded`,
        );
      }
      if (!response.ok || !response.body) {
        throw new ProviderError(
          "E_PROVIDER_STREAM_ERROR",
          `${this.config.label} responded ${response.status}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let first = true;
      let receivedFirstToken = false;
      let completed = false;

      const logComplete = (reason: "provider-done" | "upstream-eof") => {
        if (completed) return;
        completed = true;
        console.info("[StyleLens API] model:stream-complete", {
          ...logFields,
          reason,
        });
      };

      while (true) {
        if (requestSignal?.aborted) return;
        const read = reader.read();
        let result: ReadableStreamReadResult<Uint8Array>;
        if (first) {
          result = await Promise.race([
            read,
            new Promise<never>((_, reject) => {
              firstTokenTimer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(
                  new ProviderError(
                    "E_PROVIDER_TIMEOUT",
                    "First token timeout",
                  ),
                );
              }, this.firstTokenTimeoutMs);
            }),
          ]);
          clearTimeout(firstTokenTimer);
          firstTokenTimer = undefined;
          first = false;
        } else {
          result = await read;
        }

        const { done, value } = result;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            logComplete("provider-done");
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string; reasoning_content?: string };
              }>;
            };
            const delta = json.choices?.[0]?.delta;
            const reasoning = delta?.reasoning_content;
            if (reasoning) {
              if (!receivedFirstToken) {
                receivedFirstToken = true;
                console.info("[StyleLens API] model:first-token", logFields);
              }
              yield { kind: "reasoning", text: reasoning };
            }
            if (delta?.content) {
              if (!receivedFirstToken) {
                receivedFirstToken = true;
                console.info("[StyleLens API] model:first-token", logFields);
              }
              yield { kind: "content", text: delta.content };
            }
          } catch {
            // Ignore malformed provider frames and continue the stream.
          }
        }
      }
      logComplete("upstream-eof");
    } catch (err) {
      if (requestSignal?.aborted) return;
      console.error("[StyleLens API] model:stream-failed", {
        ...logFields,
        error: (err as Error)?.message ?? "stream failed",
      });
      if (err instanceof ProviderError) throw err;
      if (timedOut || (err as Error)?.name === "AbortError") {
        throw new ProviderError(
          "E_PROVIDER_TIMEOUT",
          `${this.config.label} request timed out`,
        );
      }
      throw new ProviderError(
        "E_PROVIDER_STREAM_ERROR",
        `${this.config.label} stream failed: ${(err as Error)?.message}`,
      );
    } finally {
      clearTimeout(timeout);
      clearTimeout(firstTokenTimer);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  }
}

function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  onTimeout: () => ProviderError,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(onTimeout()),
      Math.max(1, deadline - Date.now()),
    );
  });
  return Promise.race([operation, timeoutPromise]).finally(() =>
    clearTimeout(timeout),
  );
}

function imageLabel(image: VisionImage, index: number): string {
  const crop = image.crop;
  const geometry = crop
    ? ` viewport-css bounds ${crop.left},${crop.top},${crop.width}x${crop.height}`
    : "";
  return `Image ${index + 1}: ${image.kind} crop${geometry}. Use this label when citing visual evidence.`;
}

async function readJsonBody(
  response: Response,
  deadline: number,
  onTimeout: () => ProviderError,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const result = await withDeadline(reader.read(), deadline, onTimeout);
      if (result.done) {
        body += decoder.decode();
        return body;
      }

      body += decoder.decode(result.value, { stream: true });
      // Some compatible gateways send a complete JSON document but keep the
      // HTTP connection alive. The completion is usable as soon as the JSON
      // parses, so do not make the Vision slot wait for transport EOF.
      try {
        JSON.parse(body);
        await reader.cancel().catch(() => undefined);
        return body;
      } catch {
        // Continue until the document is complete or the deadline expires.
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readSseBody(
  response: Response,
  deadline: number,
  onTimeout: () => ProviderError,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let body = "";
  let doneMarker = false;

  const consumeLines = (value: string) => {
    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:") && trimmed.slice(5).trim() === "[DONE]") {
        doneMarker = true;
        return;
      }
    }
  };

  while (!doneMarker) {
    const result = await withDeadline(reader.read(), deadline, onTimeout);
    if (result.done) {
      consumeLines(decoder.decode());
      break;
    }
    const chunk = decoder.decode(result.value, { stream: true });
    body += chunk;
    consumeLines(chunk);
  }

  if (doneMarker) {
    await reader.cancel().catch(() => undefined);
  } else if (buffer) {
    consumeLines("\n");
  }
  return body;
}

type CompletionChoice = {
  message?: { content?: unknown };
  delta?: { content?: unknown };
};

function textContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;

  const text = value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .join("");
  return text || undefined;
}

function choiceContent(
  choice: CompletionChoice | undefined,
): string | undefined {
  return (
    textContent(choice?.message?.content) ?? textContent(choice?.delta?.content)
  );
}

function jsonCompletionContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  return (
    choices
      .map((choice) => choiceContent(choice as CompletionChoice))
      .filter((content): content is string => Boolean(content))
      .join("") || undefined
  );
}

function sseCompletionContent(body: string): string | undefined {
  let output = "";
  for (const frame of body.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith("data:"))
      .map((line) => line.trimStart().slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const content = jsonCompletionContent(JSON.parse(data) as unknown);
      if (content) output += content;
    } catch {
      // Ignore malformed provider frames; the final empty result becomes a typed error.
    }
  }
  return output || undefined;
}

function parseCompletionContent(
  body: string,
  contentType: string,
): string | undefined {
  if (contentType.toLowerCase().includes("text/event-stream")) {
    const streamed = sseCompletionContent(body);
    if (streamed) return streamed;
  }

  try {
    return jsonCompletionContent(JSON.parse(body) as unknown);
  } catch {
    // Some OpenAI-compatible gateways omit or rewrite content-type. Try SSE as a fallback.
    return sseCompletionContent(body);
  }
}
