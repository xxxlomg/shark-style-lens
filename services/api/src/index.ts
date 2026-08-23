import { serve } from '@hono/node-server'
import { createApp } from './app'

/**
 * StyleLens 本地后端（MVP）
 *
 * 硬约束：仅监听 127.0.0.1（用户确认），不对外提供服务。
 * Provider：配置 DEEPSEEK_API_KEY → deepseek-chat；否则 mock（本地闭环 / e2e）。
 */
const app = createApp()

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`[StyleLens API] http://${info.address}:${info.port}`)
})
