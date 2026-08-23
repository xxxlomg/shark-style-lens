import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

/**
 * StyleLens 本地后端（MVP）
 *
 * 硬约束：仅监听 127.0.0.1（用户确认），不对外提供服务。
 * Sprint 4 将在此实现 POST /api/prompt/stream（SSE + DeepSeek provider）。
 */
const app = new Hono()

app.get('/api/health', (c) => c.json({ status: 'ok', provider: 'deepseek' }))

// 官网介绍页（含拖拽安装按钮，T9）
app.use('/assets/*', serveStatic({ root: './public' }))
app.get('/stylelens.zip', serveStatic({ path: './public/stylelens.zip' }))
app.get('*', serveStatic({ path: './public/index.html' }))

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`[StyleLens API] http://${info.address}:${info.port}`)
})
