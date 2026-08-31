import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { resolve } from 'node:path'
import { configRoute } from './routes/config'
import { promptStreamRoute } from './routes/prompt-stream'
import { visionStreamRoute } from './routes/vision-stream'
import { getProviderName, getVisionDispatch, getModelConfig } from './providers'

export interface AppOptions {
  /** Absolute directory containing index.html, assets/, and stylelens.zip. */
  publicDir?: string
}

async function probeAgentConnection(config: ReturnType<typeof getModelConfig>) {
  if (config.analysisMode === 'template') {
    return { ok: true, kind: 'template' as const, message: 'template-mode' }
  }
  if (config.agent.provider !== 'deepseek' || !config.agent.apiKey) {
    return { ok: false, kind: 'local' as const, message: 'api-key-not-configured' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${config.agent.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${config.agent.apiKey}` },
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      kind: 'deepseek' as const,
      message: response.ok ? 'remote-ok' : `remote-http-${response.status}`,
    }
  } catch {
    return { ok: false, kind: 'deepseek' as const, message: 'remote-unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

/** 应用工厂（供测试、开发 server 与桌面 sidecar 复用） */
export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()
  const publicDir = resolve(
    options.publicDir ?? process.env.STYLELENS_PUBLIC_DIR ?? resolve(process.cwd(), 'public'),
  )

  // The desktop setup page runs from Tauri's local origin. The API still only
  // binds to loopback, so this does not expose the configuration remotely.
  app.use('/api/*', cors({ origin: (origin) => origin ?? '*' }))

  app.get('/api/health', async (c) => {
    const config = getModelConfig()
    const dispatch = getVisionDispatch()
    const probe = new URL(c.req.url).searchParams.get('probe') === '1'
    const connection = probe
      ? await probeAgentConnection(config)
      : {
          ok: config.analysisMode === 'template' || config.agent.provider === 'deepseek',
          kind: config.analysisMode === 'template' ? ('template' as const) : ('local' as const),
          message: config.analysisMode === 'template' ? 'template-mode' : 'local-service-ok',
        }
    return c.json({
      status: 'ok',
      provider: getProviderName(),
      configured: Boolean(config.agent.apiKey),
      modelConfig: {
        analysisMode: config.analysisMode,
        agent: { model: config.agent.model, vision: config.agent.capabilities.vision },
        vision: config.vision
          ? { model: config.vision.model, vision: config.vision.capabilities.vision }
          : null,
        visionDispatch: dispatch.kind,
      },
      connection,
    })
  })

  app.route('/api/config', configRoute)

  app.route('/api/prompt', promptStreamRoute)
  app.route('/api/prompt/vision', visionStreamRoute)

  // 安装页与扩展分发产物
  app.use('/assets/*', serveStatic({ root: publicDir }))
  app.use('/stylelens.zip', async (c, next) => {
    c.header('Content-Disposition', 'attachment; filename="stylelens.zip"')
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/stylelens.zip', serveStatic({ path: resolve(publicDir, 'stylelens.zip') }))
  app.get('/stylelens.crx', (c) => c.notFound())
  app.get('*', serveStatic({ path: resolve(publicDir, 'index.html') }))

  return app
}
