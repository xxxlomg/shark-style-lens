import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { promptStreamRoute } from './routes/prompt-stream'
import { getProviderName } from './providers'

/** 应用工厂（供测试与 serve 复用） */
export function createApp(): Hono {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({ status: 'ok', provider: getProviderName() }),
  )

  app.route('/api/prompt', promptStreamRoute)

  // 安装页与扩展分发产物
  app.use('/assets/*', serveStatic({ root: './public' }))
  app.use('/stylelens.zip', async (c, next) => {
    c.header('Content-Disposition', 'attachment; filename="stylelens.zip"')
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/stylelens.zip', serveStatic({ path: './public/stylelens.zip' }))
  app.get('/stylelens.crx', (c) => c.notFound())
  app.get('*', serveStatic({ path: './public/index.html' }))

  return app
}
