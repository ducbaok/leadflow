import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import Papa from 'papaparse'

// e2e end-to-end: import CSV mẫu → thấy leads → chấm rule → export CSV escape formula (AC-6).
// Phần review dedupe: skip cho tới khi luồng D merge (route /api/dedupe/* chưa tồn tại → 404).

// Playwright chạy từ gốc repo → dùng cwd (spec transpile ở chế độ CJS, không có import.meta).
const SAMPLE_CSV = path.join(process.cwd(), 'public', 'samples', 'leads-clean.csv')

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: /Enter demo/i }).click()
  await page.waitForURL('**/leads')
}

test.describe.configure({ mode: 'serial' })

test('import mẫu → leads → chấm rule → export escape formula (AC-6)', async ({ page }) => {
  await loginDemo(page)

  await test.step('import CSV mẫu qua wizard', async () => {
    await page.goto('/imports')
    // input file ẩn trong label — setInputFiles trực tiếp vào input.
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_CSV)
    // Sang bước map: guessedMapping đã điền → nút Start bật.
    const startBtn = page.getByRole('button', { name: /Start import/i })
    await expect(startBtn).toBeEnabled({ timeout: 30_000 })
    await startBtn.click()
    // Progress: chờ trạng thái completed (import set-based, nhanh).
    await expect(page.getByText('completed', { exact: false })).toBeVisible({ timeout: 90_000 })
  })

  await test.step('leads hiển thị trong bảng', async () => {
    await page.goto('/leads')
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })
    // Tổng số lead > 0 (đọc từ API cho chắc, tránh phụ thuộc format text).
    const res = await page.request.get('/api/leads?pageSize=1')
    expect(res.ok()).toBeTruthy()
    expect((await res.json()).total).toBeGreaterThan(0)
  })

  await test.step('chấm điểm rule (nền, set-based)', async () => {
    await page.goto('/settings')
    await page.getByRole('button', { name: /Re-score \(rules\)/i }).click()
    await expect(page.getByText(/Rule scoring enqueued/i)).toBeVisible({ timeout: 15_000 })
    // Job pg-boss chạy nền → chờ ruleScored > 0 qua status endpoint.
    await expect
      .poll(async () => (await (await page.request.get('/api/scoring/status')).json()).ruleScored ?? 0, {
        timeout: 45_000,
        intervals: [1000, 2000, 3000],
      })
      .toBeGreaterThan(0)
  })

  await test.step('export CSV — mọi ô data KHÔNG mở đầu bằng = + - @ (AC-6)', async () => {
    // Seed cài 4 lead injection (company "Injection Test Co", tên bắt đầu formula char).
    const res = await page.request.get('/api/leads/export?search=Injection')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    const csv = (await res.text()).replace(/^﻿/, '')

    const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true })
    const rows = parsed.data as string[][]
    expect(rows.length).toBeGreaterThan(1) // header + ≥1 injection lead (cần seed)

    for (const row of rows.slice(1)) {
      for (const cell of row) {
        expect(/^[=+\-@]/.test(cell), `ô "${cell.slice(0, 24)}" không được mở đầu bằng formula`).toBe(false)
      }
    }
    // Chứng cứ dương: payload nguy hiểm vẫn còn nhưng đã prefix ' (vô hiệu hoá khi mở bằng Excel).
    expect(csv).toContain("'=HYPERLINK")
  })
})

test('review dedupe (skip tới khi luồng D merge)', async ({ page }) => {
  await loginDemo(page)
  const res = await page.request.get('/api/dedupe/pairs?status=pending&page=1')
  test.skip(res.status() === 404, 'Luồng D chưa merge — /api/dedupe/pairs chưa tồn tại (404)')

  // Khi D merge: hàng đợi review hiển thị + 2 hành động "Giữ bản này"/"Không trùng" (SoT 20-dedupe-spec).
  await page.goto('/dedupe')
  const body = await res.json()
  expect(body).toHaveProperty('pairs')
  expect(Array.isArray(body.pairs)).toBeTruthy()
})
