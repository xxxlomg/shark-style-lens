import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { promptStreamRoute } from './routes/prompt-stream'

/** 应用工厂（供测试与 serve 复用） */
export function createApp(): Hono {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({ status: 'ok', provider: process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'mock' }),
  )

  app.route('/api/prompt', promptStreamRoute)

  // 官网介绍页（含拖拽安装按钮，T9）
  app.use('/assets/*', serveStatic({ root: './public' }))
  app.get('/stylelens.zip', serveStatic({ path: './public/stylelens.zip' }))
  app.get('*', serveStatic({ path: './public/index.html' }))

  return app
}
