import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// 端口可配（FIXTURES_PORT）：本机 4173 被其他项目占用时可换端口跑 e2e
const fixturesPort = Number(process.env.FIXTURES_PORT ?? 4173)
const apiPort = Number(process.env.API_PORT ?? 3001)
const e2eConfigDir = process.env.STYLELENS_CONFIG_DIR ?? join(tmpdir(), 'stylelens-e2e-config')

export default defineConfig({
  testDir: resolve(import.meta.dirname, '../../tests/e2e'),
  timeout: 60_000,
  fullyParallel: false,
  // All specs share the local fixture/API servers; serial workers keep the
  // benchmark timings and extension lifecycle deterministic on developer machines.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${fixturesPort}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/serve-fixtures.mjs',
      url: `http://127.0.0.1:${fixturesPort}`,
      reuseExistingServer: false,
      timeout: 10_000,
      env: { PORT: String(fixturesPort) },
    },
    {
      // 非 watch 模式：避免 tsx watch 在 e2e 期间因文件变更重启而挂掉
      // 强制 mock provider：e2e 断言依赖确定性的 Compiler markdown 输出，
      // 不受机器上已配置的 DEEPSEEK_API_KEY 影响。
      // 注意：不走 `pnpm start`（其 --env-file 会覆盖空 env 导致真实 Key 生效），
      // 直接 node 启动且不加载 .env；密钥回退默认 stylelens-dev 与扩展一致。
      command: 'node --import tsx src/index.ts',
      cwd: resolve(import.meta.dirname, '../../services/api'),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: {
        DEEPSEEK_API_KEY: '',
        STYLELENS_CONFIG_DIR: e2eConfigDir,
        STYLELENS_ENV_FILE: '',
        PORT: String(apiPort),
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
