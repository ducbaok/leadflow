// Smoke test môi trường sống (luồng G, gate M3) — CHỈ ĐỌC, không ghi gì vào DB.
// Khác với scripts/verify-acceptance.mjs (chạy toàn bộ AC, GHI ~10k lead): file này chỉ
// trả lời "bản deploy này còn sống và đủ dữ liệu để demo không?" — chạy được sau mỗi lần deploy.
// Cách chạy:  BASE=https://<domain> npm run smoke      (mặc định BASE=http://localhost:3000)
const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '')

let cookie = ''
const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
async function api(path, opts = {}) {
  return fetch(BASE + path, { ...opts, headers: { cookie, ...(opts.headers ?? {}) }, redirect: 'manual' })
}

console.log(`Smoke test → ${BASE}\n`)

// 1. Health — route duy nhất không cần session
try {
  const res = await api('/api/health')
  const body = await res.json().catch(() => ({}))
  check('health', res.status === 200 && body.db === 'up', `status=${res.status} db=${body.db} boss=${body.boss}`)
  if (body.boss !== 'up') console.log('  ⚠ pg-boss không chạy → import/dedupe/scoring sẽ đứng ở hàng đợi')
} catch (err) {
  check('health', false, String(err))
}

// 2. Rào cửa: route cần session mà chưa login phải trả 401
{
  const res = await api('/api/leads?pageSize=1')
  check('proxy chặn khi chưa login', res.status === 401, `status=${res.status}`)
}

// 3. Login demo 1-click.
// Location phải TƯƠNG ĐỐI: bản standalone từng trả `http://0.0.0.0:3000/leads` (host mà server bind)
// làm trình duyệt không đi tiếp được — lỗi chỉ lộ sau reverse proxy, nên kiểm ở đây.
{
  const res = await api('/api/auth/demo', { method: 'POST' })
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  const location = res.headers.get('location') ?? ''
  check(
    'login demo',
    res.status === 303 && cookie.includes('leadflow_session') && location.startsWith('/'),
    `status=${res.status} location=${location}`,
  )
}

// 4. Dashboard có dữ liệu (demo trống = portfolio chết)
let sampleId = null
{
  const res = await api('/api/leads?pageSize=5')
  const body = await res.json().catch(() => ({}))
  sampleId = body?.rows?.[0]?.id ?? null
  check('leads có dữ liệu', res.status === 200 && (body.total ?? 0) > 1000, `total=${body.total}`)
}

// 5. Trang chi tiết lead (nguồn + lịch sử điểm)
if (sampleId) {
  const res = await api(`/api/leads/${sampleId}`)
  const body = await res.json().catch(() => ({}))
  check('lead detail', res.status === 200 && Array.isArray(body.sources), `sources=${body?.sources?.length}`)
}

// 6. Dedupe: có cặp chờ review (seed cài sẵn ~150 cặp fuzzy)
{
  const res = await api('/api/dedupe/pairs?status=pending&page=1')
  const body = await res.json().catch(() => ({}))
  check('dedupe pairs', res.status === 200, `total=${body.total ?? 0}`)
  if ((body.total ?? 0) === 0) console.log('  ⚠ chưa có cặp nào — chạy POST /api/dedupe/scan để quét')
}

// 7. Scoring status
{
  const res = await api('/api/scoring/status')
  const body = await res.json().catch(() => ({}))
  check('scoring status', res.status === 200, JSON.stringify(body))
  if ((body.ruleScored ?? 0) === 0) console.log('  ⚠ chưa lead nào có điểm rule — bấm "Score with rules" để demo có 2 cột điểm')
}

// 8. Export CSV phải escape ô bắt đầu bằng = + - @ (seed cài sẵn 4 lead injection)
{
  const res = await api('/api/leads/export?search=Injection Test Co')
  const text = res.ok ? await res.text() : ''
  const risky = text.split('\n').slice(1).flatMap((line) => line.split(',')).filter((cell) => /^"?[=+\-@]/.test(cell))
  check('export escape CSV injection', res.status === 200 && risky.length === 0, `ô chưa escape: ${risky.length}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} pass`)
if (failed.length) {
  console.log('Fail:', failed.map((f) => f.name).join(', '))
  process.exit(1)
}
