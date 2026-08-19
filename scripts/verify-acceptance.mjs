// Acceptance verification (gate M1/M3) — chạy TOÀN BỘ luồng thật qua HTTP:
// import 10k → idempotency → messy → dashboard → export → rule + AI scoring.
// ⚠️ GHI DỮ LIỆU THẬT vào DB của server đích (import ~10k lead, đổi aiTopN=3).
//    Chỉ chạy trên DB test/staging; sau khi chạy trên demo hãy `npm run seed` để reset.
// Cách chạy:  BASE=http://localhost:3010 node scripts/verify-acceptance.mjs
//             (mặc định BASE=http://localhost:3000; SKIP_AI=1 để bỏ phần AI live)
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const SKIP_AI = process.env.SKIP_AI === '1'

let cookie = ''
const results = []
function report(id, ok, detail) { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`) }

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { cookie, ...(opts.headers ?? {}) }, redirect: 'manual' })
  return res
}
async function json(path, opts) { const r = await api(path, opts); return { status: r.status, body: await r.json().catch(() => null) } }

// ── login ──
{
  const res = await fetch(BASE + '/api/auth/demo', { method: 'POST', redirect: 'manual' })
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  report('auth', res.status === 303 && cookie.includes('leadflow_session'), `status=${res.status}`)
}

const total0 = (await json('/api/leads?pageSize=1')).body?.total
console.log('leads trước import:', total0)

async function importFile(path, mappingOverride) {
  const fd = new FormData()
  fd.append('file', new Blob([readFileSync(path)], { type: 'text/csv' }), path.split('/').pop())
  const up = await json('/api/imports', { method: 'POST', body: fd })
  if (up.status !== 200) throw new Error(`upload fail ${up.status}: ${JSON.stringify(up.body)}`)
  const { batchId, guessedMapping } = up.body
  const mapping = mappingOverride ?? guessedMapping
  const st = await json(`/api/imports/${batchId}/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapping }),
  })
  if (st.status !== 200) throw new Error(`start fail ${st.status}: ${JSON.stringify(st.body)}`)
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const b = (await json(`/api/imports/${batchId}`)).body
    const batch = b.batch ?? b
    if (batch.status === 'completed' || batch.status === 'failed') return { ...batch, errors: b.errors }
  }
  throw new Error('timeout chờ batch')
}

const MAP_10K = { full_name: 'fullName', email: 'email', company: 'companyName', title: 'title', industry: 'industry', company_size: 'companySize', phone: 'phone' }

// ── AC-1: import 10k < 30s ──
const b1 = await importFile('public/samples/leads-10k.csv', MAP_10K)
report('AC-1', b1.status === 'completed' && b1.durationMs < 30000,
  `status=${b1.status} duration=${b1.durationMs}ms total=${b1.totalRows} inserted=${b1.insertedLeads} updated=${b1.updatedLeads} errors=${b1.errorRows}`)
const total1 = (await json('/api/leads?pageSize=1')).body?.total
console.log('leads sau import 10k:', total1)

// ── AC-2: re-import cùng file → 0 lead mới ──
const b2 = await importFile('public/samples/leads-10k.csv', MAP_10K)
const total2 = (await json('/api/leads?pageSize=1')).body?.total
report('AC-2', b2.status === 'completed' && total2 === total1 && b2.insertedLeads === 0,
  `inserted=${b2.insertedLeads} updated=${b2.updatedLeads} total ${total1}→${total2}`)

// ── AC-3 + AC-4: messy file (header lạ → dùng guessedMapping), lỗi từng dòng, no-email vẫn vào ──
const b3 = await importFile('public/samples/leads-messy.csv')
report('AC-3', b3.status === 'completed' && b3.errorRows > 0 && b3.errors?.length > 0,
  `status=${b3.status} valid=${b3.validRows} errors=${b3.errorRows} (sample: ${b3.errors?.[0]?.message})`)
const total3 = (await json('/api/leads?pageSize=1')).body?.total
report('AC-4', total3 > total2, `total ${total2}→${total3} (no-email + messy hợp lệ được import)`)

// ── AC-5: server-side filter/sort/pagination ──
const t0 = Date.now()
const list = await json('/api/leads?page=2&pageSize=50&sort=companySize&order=desc&status=new&search=nguyen')
const ms = Date.now() - t0
report('AC-5', list.status === 200 && Array.isArray(list.body.rows) && typeof list.body.total === 'number' && ms < 1500,
  `rows=${list.body.rows?.length} total=${list.body.total} ${ms}ms (lạnh, chưa warm)`)
const hasScoreFields = list.body.rows?.[0] && 'ruleScore' in list.body.rows[0] && 'aiScore' in list.body.rows[0]
report('contract-leads-shape', !!hasScoreFields, `ruleScore/aiScore có trong shape (null ở Batch 1)`)

// ── AC-6: export escape formula ──
const exp = await api('/api/leads/export?search=Injection')
const csv = await exp.text()
const neutralized = csv.includes("'=HYPERLINK") && !/\n=HYPERLINK/.test(csv)
report('AC-6', exp.status === 200 && neutralized, `export ${csv.split('\n').length} dòng, '=HYPERLINK bị vô hiệu: ${neutralized}`)

// ── AC-rule: chấm rule toàn bộ ──
const run = await json('/api/scoring/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'rule' }) })
let ruleScored = 0
for (let i = 0; i < 45; i++) {
  await new Promise(r => setTimeout(r, 2000))
  const s = (await json('/api/scoring/status')).body
  ruleScored = s?.ruleScored ?? 0
  if (ruleScored >= run.body.enqueued) break
}
report('rule-scoring', ruleScored >= run.body.enqueued && run.body.enqueued > 10000,
  `enqueued=${run.body.enqueued} ruleScored=${ruleScored}`)

// ── AC-7 smoke (AI, 3 lead, key thật): run ai với topN=3 ──
const cfg = SKIP_AI ? { status: 0 } : await json('/api/scoring/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aiTopN: 3 }) })
if (cfg.status === 200) {
  const runAi = await json('/api/scoring/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ai' }) })
  let st = null
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    st = (await json('/api/scoring/status')).body
    if ((st?.aiScored ?? 0) + (st?.aiFailed ?? 0) >= 3) break
  }
  report('AI-live', (st?.aiScored ?? 0) >= 3, `enqueued=${runAi.body?.enqueued} aiScored=${st?.aiScored} aiFailed=${st?.aiFailed} aiPending=${st?.aiPending}`)
  // chạy lại → cache hash trùng → aiScored không đổi, không gọi thêm (kiểm gián tiếp qua thời gian hoàn thành tức thì)
  await json('/api/scoring/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ai' }) })
  await new Promise(r => setTimeout(r, 6000))
  const st2 = (await json('/api/scoring/status')).body
  report('AC-7-cache', st2?.aiScored === st?.aiScored && st2?.aiFailed === (st?.aiFailed ?? 0), `re-run: aiScored ${st?.aiScored}→${st2?.aiScored} (hash trùng → skip)`)
}

console.log('\n=== TỔNG KẾT ===')
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.id} — ${r.detail}`)
process.exit(results.every(r => r.ok) ? 0 : 1)
