/**
 * Quay GIF demo cho README (AC-17) — lái app thật bằng Playwright, chụp frame đều đặn,
 * rồi mã hoá GIF bằng gifenc (không cần ffmpeg).
 *
 * Cần app đang chạy KÈM dữ liệu đẹp: đã seed, đã chấm rule, đã scan dedupe, đã chấm AI vài chục lead.
 * Cách chạy:  BASE=http://localhost:3012 npm run demo:gif
 * Kết quả:    docs/demo.gif
 *
 * ⚠️ Kịch bản có bấm "Keep this one" ở trang dedupe → GHI dữ liệu. Chỉ chạy trên DB demo/test.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import gifenc from 'gifenc' // CJS: không có named export
const { GIFEncoder, applyPalette, quantize } = gifenc
import { PNG } from 'pngjs'

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const OUT = 'docs/demo.gif'
// Layout 1520x900 CSS thu về 0.75 pixel/CSS-px: đủ rộng để bảng lead hiện CẢ hai cột điểm
// (ở 1100px chúng bị cắt khỏi khung) mà file GIF vẫn nhỏ.
const CSS_WIDTH = 1520
const CSS_HEIGHT = 900
const SCALE = 0.75
const WIDTH = Math.round(CSS_WIDTH * SCALE)
const HEIGHT = Math.round(CSS_HEIGHT * SCALE)
const FRAME_MS = 500 // 2 fps — đủ mượt cho thao tác UI, giữ file nhỏ
const PALETTE_COLORS = 128

const frames = []

async function shoot(page) {
  const buf = await page.screenshot({ type: 'png' })
  const png = PNG.sync.read(buf)
  frames.push(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length))
}

/** Chụp liên tục trong `ms` mili giây → tạo chuyển động thật thay vì slideshow. */
async function hold(page, ms, label) {
  const n = Math.max(1, Math.round(ms / FRAME_MS))
  process.stdout.write(`  ${label}: ${n} frame\n`)
  for (let i = 0; i < n; i++) {
    await shoot(page)
    await page.waitForTimeout(FRAME_MS)
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: CSS_WIDTH, height: CSS_HEIGHT },
  deviceScaleFactor: SCALE,
})

console.log(`Quay demo từ ${BASE}`)

// 1. Cửa vào demo 1-click
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await hold(page, 2000, 'login')

// 2. Vào dashboard
await page.getByRole('button', { name: /Enter demo/i }).click()
await page.waitForURL('**/leads')
await page.waitForSelector('table tbody tr')
await hold(page, 3000, 'leads')

// 3. Sắp theo điểm AI giảm dần — hai cột điểm tách biệt nằm cạnh nhau
await page.goto(`${BASE}/leads?sort=aiScore&order=desc`, { waitUntil: 'networkidle' })
await page.waitForSelector('table tbody tr')
await hold(page, 3500, 'leads sắp theo AI')

// 4. Chi tiết lead: nguồn + lịch sử điểm kèm lý do AI
await page.locator('table tbody tr').first().getByRole('link', { name: /View/i }).click()
await page.waitForURL(/\/leads\/[0-9a-f-]{36}/)
await hold(page, 4000, 'lead detail')

// 5. Hàng đợi review trùng lặp
await page.goto(`${BASE}/dedupe`, { waitUntil: 'networkidle' })
await hold(page, 4000, 'dedupe queue')

// 6. Quyết định giữ một bản (ghi dữ liệu)
const keep = page.getByRole('button', { name: /Keep this one/i }).first()
if (await keep.isVisible().catch(() => false)) {
  await keep.click()
  await hold(page, 3000, 'sau khi merge')
}

// 7. Cấu hình scoring: rule JSON + mô tả ICP cho AI
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await hold(page, 3500, 'settings')

// 8. Wizard import
await page.goto(`${BASE}/imports`, { waitUntil: 'networkidle' })
await hold(page, 3000, 'imports')

// 9. Kết ở dashboard
await page.goto(`${BASE}/leads?sort=aiScore&order=desc`, { waitUntil: 'networkidle' })
await page.waitForSelector('table tbody tr')
await hold(page, 2000, 'kết')

await browser.close()

// ── mã hoá GIF ──
// Một palette CHUNG cho mọi frame: giao diện dark theme ít màu nên 128 màu là thừa đẹp,
// mà palette chung cho file nhỏ hơn nhiều so với palette riêng từng frame.
console.log(`\n${frames.length} frame → dựng palette ${PALETTE_COLORS} màu...`)
const sampleStep = Math.max(1, Math.floor(frames.length / 12))
const sampled = frames.filter((_, i) => i % sampleStep === 0)
const merged = new Uint8ClampedArray(sampled.length * WIDTH * HEIGHT * 4)
sampled.forEach((f, i) => merged.set(f, i * WIDTH * HEIGHT * 4))
const palette = quantize(merged, PALETTE_COLORS, { format: 'rgb565' })

const gif = GIFEncoder()
for (const [i, frame] of frames.entries()) {
  gif.writeFrame(applyPalette(frame, palette, 'rgb565'), WIDTH, HEIGHT, {
    palette: i === 0 ? palette : undefined,
    delay: FRAME_MS,
  })
  if (i % 10 === 0) process.stdout.write(`  ${i}/${frames.length}\r`)
}
gif.finish()

mkdirSync('docs', { recursive: true })
const bytes = gif.bytes()
writeFileSync(OUT, bytes)
console.log(`\n✓ ${OUT} — ${frames.length} frame, ${(bytes.length / 1024 / 1024).toFixed(1)} MB, ~${((frames.length * FRAME_MS) / 1000).toFixed(0)}s`)
