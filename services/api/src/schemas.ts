import { z } from "zod";

/** 后端请求体结构校验（§5.3）：完整 StyleProfile schema 在 extension 侧，后端只做结构校验 */
export const promptStreamRequestSchema = z.object({
  profile: z
    .object({
      version: z.string(),
      target: z.object({ uid: z.string(), tagName: z.string() }),
      context: z.record(z.string(), z.unknown()),
      layout: z.record(z.string(), z.unknown()),
      typography: z.record(z.string(), z.unknown()),
      visual: z.record(z.string(), z.unknown()),
      facts: z.array(
        z.object({
          property: z.string(),
          value: z.string(),
          source: z.string(),
          confidence: z.number().optional(),
        }),
      ),
      inferences: z.array(z.record(z.string(), z.unknown())),
      warnings: z.array(z.record(z.string(), z.unknown())),
    })
    .passthrough(),
  images: z
    .array(
      z.object({
        kind: z.enum(["target", "context"]),
        coordinateSpace: z.literal("viewport-css"),
        dataUrl: z
          .string()
          .max(12_000_000)
          .regex(/^data:image\/png;base64,/),
        width: z.number().positive(),
        height: z.number().positive(),
        crop: z.object({
          kind: z.enum(["target", "context"]),
          coordinateSpace: z.literal("viewport-css"),
          left: z.number(),
          top: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        }),
      }),
    )
    .max(8)
    .optional(),
  options: z
    .object({
      targetFramework: z
        .enum(["agnostic", "react", "vue", "html-css", "tailwind", "nextjs"])
        .optional(),
      language: z.literal("en").optional(),
      detail: z.enum(["compact", "balanced", "detailed"]).optional(),
      includeStates: z.boolean().optional(),
    })
    .optional(),
});

export type PromptStreamRequest = z.infer<typeof promptStreamRequestSchema>;

const SENSITIVE_KEY =
  /^(password|authorization|cookie|localStorage|sessionStorage|indexedDB)$/i;
const SENSITIVE_TEXT =
  /(bearer\s+[a-z0-9._-]+|api[_ -]?key\s*[:=]|password\s*[:=]|authorization\s*[:=]|cookie\s*[:=])/i;

/** Defense in depth for callers that bypass the extension's collection sanitizer. */
export function findSensitivePayload(
  value: unknown,
  path = "$",
): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitivePayload(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) return `${path}.${key}`;
      const found = findSensitivePayload(item, `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  }
  return typeof value === "string" && SENSITIVE_TEXT.test(value)
    ? path
    : undefined;
}

/** Vision input: local base64 data URLs only; external URLs are not accepted by the local API. */
export const visionStreamRequestSchema = z.object({
  task: z.string().min(1),
  images: z
    .array(
      z.union([
        z
          .string()
          .max(12_000_000)
          .regex(/^data:image\/png;base64,/),
        z.object({
          kind: z.enum(["target", "context"]),
          coordinateSpace: z.literal("viewport-css"),
          dataUrl: z
            .string()
            .max(12_000_000)
            .regex(/^data:image\/png;base64,/),
          width: z.number().positive(),
          height: z.number().positive(),
          crop: z.object({
            kind: z.enum(["target", "context"]),
            coordinateSpace: z.literal("viewport-css"),
            left: z.number(),
            top: z.number(),
            width: z.number().positive(),
            height: z.number().positive(),
          }),
        }),
      ]),
    )
    .min(1)
    .max(8),
  imageDetail: z.enum(["low", "high", "original", "auto"]).optional(),
});

export type VisionStreamRequest = z.infer<typeof visionStreamRequestSchema>;

/** User-facing local configuration. The API key is write-only from the UI. */
export const userConfigPatchSchema = z.object({
  apiKey: z.string().max(400).optional(),
  baseUrl: z.string().trim().min(1).max(500).optional(),
  agentModel: z.string().trim().min(1).max(200).optional(),
  visionModel: z.string().trim().min(1).max(200).optional(),
  analysisMode: z.enum(['template', 'text', 'multimodal']).optional(),
  thinkingEnabled: z.boolean().optional(),
  reasoningEffort: z.enum(["low", "high", "max"]).optional(),
});

export type UserConfigPatchRequest = z.infer<typeof userConfigPatchSchema>;
