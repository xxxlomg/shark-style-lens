import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: resolve(import.meta.dirname, '../../tests/e2e'),
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-fixtures.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
