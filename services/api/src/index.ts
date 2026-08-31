import { startServer, stopServer } from './server'
import { readUserConfig } from './config/user-config'
import { loadLocalEnv } from './load-local-env'

loadLocalEnv()

/**
 * StyleLens 本地后端（MVP）
 *
 * 硬约束：仅监听 127.0.0.1（用户确认），不对外提供服务。
 * Provider：DeepSeek；未配置 Key 时仅使用本地 mock。桌面版从共享用户配置读取，开发版可使用 env。
 */
async function main() {
  const port = Number(process.env.PORT ?? readUserConfig().api.port)
  const started = await startServer({
    port,
    publicDir: process.env.STYLELENS_PUBLIC_DIR,
  })

  const shutdown = () => {
    void stopServer(started.server).finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void main().catch((error) => {
  console.error('[StyleLens API] server:start-failed', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exitCode = 1
})
