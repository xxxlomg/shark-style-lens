import { Hono } from 'hono'
import {
  getUserConfigPath,
  isAllowedProviderBaseUrl,
  readUserConfig,
  toPublicUserConfig,
  writeUserConfig,
} from '../config/user-config'
import { authMiddleware } from '../middleware/auth'
import { userConfigPatchSchema } from '../schemas'

/** Local-only setup API. It never returns the stored API key. */
export const configRoute = new Hono()

configRoute.use('*', authMiddleware())

configRoute.get('/', (c) => {
  const config = readUserConfig()
  return c.json(toPublicUserConfig(config))
})

configRoute.put('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'E_INVALID_PAYLOAD', message: 'Request body must be JSON' } }, 400)
  }

  const parsed = userConfigPatchSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'E_INVALID_PAYLOAD',
          message: 'Configuration failed validation',
          detail: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
        },
      },
      400,
    )
  }

  if (parsed.data.baseUrl !== undefined && !isAllowedProviderBaseUrl(parsed.data.baseUrl)) {
    return c.json(
      {
        error: {
          code: 'E_INVALID_BASE_URL',
          message: 'Base URL must be api.deepseek.com or a loopback development proxy',
        },
      },
      400,
    )
  }

  try {
    const config = writeUserConfig(parsed.data)
    console.info('[StyleLens API] config:updated', {
      configPath: getUserConfigPath(),
      provider: config.provider.name,
      apiKeyConfigured: Boolean(config.provider.apiKey),
      thinkingEnabled: config.thinkingEnabled,
      reasoningEffort: config.reasoningEffort,
    })
    return c.json(toPublicUserConfig(config))
  } catch (error) {
    console.error('[StyleLens API] config:update-failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return c.json(
      { error: { code: 'E_CONFIG_WRITE_FAILED', message: 'Unable to save local configuration' } },
      500,
    )
  }
})
