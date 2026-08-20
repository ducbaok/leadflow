import { defineConfig, devices } from '@playwright/test'

// e2e cho luồng F. Flow: login demo → import CSV mẫu → thấy leads → chấm rule → export (AC-6).
// SoT liên quan: docs/sot/40-api-contracts.md (routes), 00-scope §non-functional (CSV injection).
//
// Server dưới test:
//  - Mặc định `npm run build && npm run start` (prod) — KHÔNG dùng `next dev` vì next dev ghi lại
//    block agent vào AGENTS.md (xem AGENTS.md) → làm bẩn diff. Prod build cũng sát production hơn.
//  - Next tự nạp .env.local (DATABASE_URL, SESSION_SECRET, ANTHROPIC_*). CI truyền qua env workflow.
//  - pg-boss boot cùng process qua src/instrumentation.ts → import/scoring job chạy được.
//  - Local đã có server sẵn (vd. `npm run start`) → reuseExistingServer nhặt lại, không build lại.
//
// Cần cài browser 1 lần: `npx playwright install chromium`.

const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // CI thêm html reporter: workflow upload playwright-report/ làm artifact khi test đỏ
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.PW_WEB_CMD ?? 'npm run build && npm run start',
    url: BASE_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
