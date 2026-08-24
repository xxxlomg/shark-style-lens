import { serve } from '@hono/node-server'
import { createApp } from './app'
import { loadLocalEnv } from './load-local-env'

loadLocalEnv()

/**
 * StyleLens 本地后端（MVP）
 *
 * 硬约束：仅监听 127.0.0.1（用户确认），不对外提供服务。
 * Provider：DeepSeek → OpenAI GPT → mock；Key 均只从本地服务端 env 读取。
 */
const app = createApp()

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`[StyleLens API] http://${info.address}:${info.port}`)
})
