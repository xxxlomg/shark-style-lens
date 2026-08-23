import { z } from 'zod'

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
      facts: z.array(z.object({ property: z.string(), value: z.string() })),
      inferences: z.array(z.record(z.string(), z.unknown())),
      warnings: z.array(z.record(z.string(), z.unknown())),
    })
    .passthrough(),
  options: z
    .object({
      targetFramework: z
        .enum(['agnostic', 'react', 'vue', 'html-css', 'tailwind', 'nextjs'])
        .optional(),
      language: z.literal('en').optional(),
      detail: z.enum(['compact', 'balanced', 'detailed']).optional(),
      includeStates: z.boolean().optional(),
    })
    .optional(),
})

export type PromptStreamRequest = z.infer<typeof promptStreamRequestSchema>
