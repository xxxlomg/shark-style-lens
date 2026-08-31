/**
 * Extension 消息协议 —— TypeScript 类型 + Zod schema
 *
 * 与 docs/MESSAGE_PROTOCOL.md §3 一一对应（配套文档 B）。
 * 所有消息 payload 经 Zod 校验；非法 payload 必须回复 E_INVALID_PAYLOAD。
 */
import { z } from 'zod'
import { rectSchema, styleProfileSchema } from './style-profile'

export const selectedElementSchema = z.object({
  uid: z.string(),
  tagName: z.string(),
  selector: z.string(),
  rect: rectSchema,
  classes: z.array(z.string()),
  scope: z.enum(['element', 'component']),
})
export type SelectedElement = z.infer<typeof selectedElementSchema>

export const analysisOptionsSchema = z.object({
  maxAncestorDepth: z.number().int().min(1).max(20).optional(),
  maxChildren: z.number().int().min(1).max(50).optional(),
  includePseudoElements: z.boolean().optional(),
})
export type AnalysisOptions = z.infer<typeof analysisOptionsSchema>

export const analysisRequestSchema = z.object({
  targetUid: z.string(),
  scope: z.enum(['element', 'component']),
  options: analysisOptionsSchema.optional(),
})
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>

export const analysisProgressSchema = z.object({
  phase: z.enum([
    'preparing',
    'inspecting-structure',
    'understanding-layout',
    'collecting-styles',
    'building-profile',
  ]),
  progress: z.number().min(0).max(100),
})
export type AnalysisProgress = z.infer<typeof analysisProgressSchema>

export const promptChunkSchema = z.object({
  text: z.string(),
})
export type PromptChunk = z.infer<typeof promptChunkSchema>

export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
  detail: z.string().optional(),
})
export type ErrorPayload = z.infer<typeof errorPayloadSchema>

export const extensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SELECTION_START') }),
  z.object({ type: z.literal('ELEMENT_SELECTED'), payload: selectedElementSchema }),
  z.object({ type: z.literal('ANALYSIS_START'), payload: analysisRequestSchema }),
  z.object({ type: z.literal('ANALYSIS_PROGRESS'), payload: analysisProgressSchema }),
  z.object({ type: z.literal('STYLE_PROFILE_READY'), payload: styleProfileSchema }),
  z.object({ type: z.literal('VISION_CAPTURE_PREPARE') }),
  z.object({ type: z.literal('VISION_CAPTURE_RESTORE') }),
  z.object({ type: z.literal('PROMPT_START') }),
  z.object({ type: z.literal('PROMPT_CHUNK'), payload: promptChunkSchema }),
  z.object({ type: z.literal('PROMPT_REASONING_CHUNK'), payload: promptChunkSchema }),
  z.object({ type: z.literal('PROMPT_COMPLETE') }),
  z.object({ type: z.literal('PROMPT_CANCEL') }),
  z.object({ type: z.literal('ANALYSIS_ERROR'), payload: errorPayloadSchema }),
])
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>
