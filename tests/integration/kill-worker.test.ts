import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { auditLog, importBatches, importRows, leadSources } from '@/db/schema'
import { normalizeMappedRow, invertMapping } from '@/lib/import/normalize-row'
import { processImport } from '@/lib/import/process'
import type { ColumnMapping } from '@/lib/import/fields'
import { closeDb, getDrizzle, hasDb } from './helpers/db'

// AC-14 — "kill process giữa chừng import → chạy lại → kết quả cuối GIỐNG HỆT" (đếm leads, sources).
// SoT: docs/sot/10-data-model.md §import_batches "Job chết giữa chừng → chạy lại vô hại" (ADR-003).
// Cách kiểm chứng: stage 1 batch lớn (có dupe + no-email + invalid), spawn tiến trình con chạy
// import THẬT, SIGKILL giữa chừng, rồi resume trong tiến trình test và so với kỳ vọng phân tích.
// Kỳ vọng bất biến với thời điểm kill: dù chết trước/giữa/sau, resume phải hội tụ về CÙNG kết quả.

const RUNNER = fileURLToPath(new URL('./helpers/promote-runner.mts', import.meta.url))
const INV = invertMapping({ full_name: 'fullName', email: 'email', company: 'companyName' } as ColumnMapping)
const MAPPING: ColumnMapping = { full_name: 'fullName', email: 'email', company: 'companyName' }

// Namespace theo run token → không đụng email seed, xoá sạch được sau test.
const RUN = crypto.randomUUID().slice(0, 8)

type Raw = { full_name: string; email: string; company: string }

function makeDataset() {
  const EMAILED = 4000, DISTINCT = 2000, NOEMAIL = 300, INVALID = 100
  const rows: Raw[] = []
  for (let i = 0; i < EMAILED; i++) rows.push({ full_name: `User ${i}`, email: `k${i % DISTINCT}.${RUN}@corp.test`, company: `Co ${i % 50}` })
  for (let j = 0; j < NOEMAIL; j++) rows.push({ full_name: `NoMail ${j} ${RUN}`, email: '', company: `Co ${j % 50}` })
  for (let k = 0; k < INVALID; k++) rows.push({ full_name: `Bad ${k} ${RUN}`, email: 'bad', company: 'X' })

  // Kỳ vọng phân tích, tính bằng CHÍNH normalizeMappedRow của luồng A (không đoán).
  const distinctEmails = new Set<string>()
  let noEmailValid = 0, valid = 0
  for (const r of rows) {
    const n = normalizeMappedRow(r, INV)
    if (n.validation_error) continue
    valid++
    if (n.email_normalized) distinctEmails.add(n.email_normalized)
    else noEmailValid++
  }
  return {
    rows,
    expected: {
      leads: distinctEmails.size + noEmailValid, // 2000 + 300 = 2300
      sources: valid, // 4300
      valid,
      errors: rows.length - valid, // 100
      total: rows.length, // 4400
    },
  }
}

const createdBatches: string[] = []

async function stageRawBatch(rows: Raw[]): Promise<string> {
  const db = getDrizzle()
  const [b] = await db
    .insert(importBatches)
    .values({ filename: `killtest-${RUN}.csv`, sourceType: 'csv', status: 'pending', mapping: MAPPING })
    .returning({ id: importBatches.id })
  createdBatches.push(b.id)
  // Chỉ đổ THÔ (raw jsonb) — processImport sẽ normalize, y như luồng thật sau parseAndStage.
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000)
    await db.insert(importRows).values(chunk.map((raw, k) => ({ batchId: b.id, rowNumber: i + k + 1, raw })))
  }
  return b.id
}

async function batchOutcome(batchId: string) {
  const db = getDrizzle()
  const distinctLeads = (await db.execute(sql`
    SELECT count(DISTINCT lead_id)::int AS d FROM import_rows WHERE batch_id = ${batchId} AND lead_id IS NOT NULL
  `)) as unknown as { d: number }[]
  const srcs = (await db.execute(sql`
    SELECT count(*)::int AS c FROM lead_sources WHERE import_batch_id = ${batchId}
  `)) as unknown as { c: number }[]
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1)
  return { distinctLeads: distinctLeads[0].d, sources: srcs[0].c, batch }
}

function runImportInChild(batchId: string) {
  return spawn(process.execPath, ['--import', 'tsx', RUNNER, batchId], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe.skipIf(!hasDb)('AC-14 kill-worker — import idempotent qua crash + resume', () => {
  beforeAll(() => {
    // spawn tsx + processImport 4400 dòng có thể cần thời gian; nới timeout ở config đã đủ.
  })

  afterAll(async () => {
    // Dọn mọi thứ test tạo ra (dữ liệu ĐÃ COMMIT vì đi qua getDb() của src, không rollback được).
    // Batch dùng chung lead đã dedupe → phải xoá HẾT lead_sources trước, rồi mới xoá leads (set-based
    // subquery, tránh IN-list vài nghìn tham số + tránh vi phạm FK giữa các batch).
    const db = getDrizzle()
    for (const batchId of createdBatches) {
      await db.delete(leadSources).where(eq(leadSources.importBatchId, batchId))
    }
    for (const batchId of createdBatches) {
      await db.execute(sql`
        DELETE FROM leads WHERE id IN (
          SELECT DISTINCT lead_id FROM import_rows WHERE batch_id = ${batchId} AND lead_id IS NOT NULL
        )
      `)
    }
    for (const batchId of createdBatches) {
      await db.delete(auditLog).where(eq(auditLog.entityId, batchId))
      await db.delete(importBatches).where(eq(importBatches.id, batchId)) // cascade import_rows
    }
    await closeDb()
  })

  it('SIGKILL giữa import rồi resume → leads & sources đúng như kỳ vọng phân tích', async () => {
    const { rows, expected } = makeDataset()
    const batchId = await stageRawBatch(rows)

    // ── spawn tiến trình con chạy import thật, đợi nó THỰC SỰ vào processImport rồi SIGKILL ──
    // Kill 150ms SAU khi con in RUNNER_STARTED (tránh cắt trúng lúc tsx còn đang cold-start ~350ms,
    // khi đó chưa có tiến triển gì) → nhát cắt rơi vào giữa normalize/promote.
    const child = runImportInChild(batchId)
    let started = false
    const exitCode: number | null = await new Promise((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const hardFallback = setTimeout(() => child.kill('SIGKILL'), 8000)
      child.stdout.on('data', (d) => {
        if (String(d).includes('RUNNER_STARTED') && !started) {
          started = true
          killTimer = setTimeout(() => child.kill('SIGKILL'), 150)
        }
      })
      child.on('exit', (code) => {
        clearTimeout(hardFallback)
        if (killTimer) clearTimeout(killTimer)
        resolve(code)
      })
    })
    // Bị SIGKILL → exitCode thường null (bị signal). Nếu con kịp xong (exit 0) cũng chấp nhận:
    // resume vẫn phải cho kết quả y hệt (bất biến).
    const midState = await batchOutcome(batchId)

    // ── resume trong tiến trình test: chạy lại từ đầu (idempotent) ──
    // Nếu con đã kịp set 'completed', reset để processImport chạy lại thay vì no-op (mô phỏng
    // re-delivery của pg-boss sau crash — vẫn phải hội tụ).
    if (midState.batch.status === 'completed') {
      await getDrizzle().update(importBatches).set({ status: 'processing' }).where(eq(importBatches.id, batchId))
    }
    await processImport(batchId)

    const final = await batchOutcome(batchId)
    expect(final.distinctLeads, 'distinct leads sau resume').toBe(expected.leads)
    expect(final.sources, 'lead_sources sau resume').toBe(expected.sources)
    expect(final.batch.status).toBe('completed')
    expect(final.batch.validRows).toBe(expected.valid)
    expect(final.batch.errorRows).toBe(expected.errors)
    expect(final.batch.totalRows).toBe(expected.total)

    // Ghi chú chẩn đoán cho báo cáo (killed → started=%s, exit=%s, mid status=%s).
    console.log(`[AC-14] child started=${started} exit=${exitCode} midStatus=${midState.batch.status} midLeads=${midState.distinctLeads}`)
  })

  it('re-delivery sau khi completed → chạy lại KHÔNG tạo trùng (đếm bất biến)', async () => {
    const { rows, expected } = makeDataset()
    const batchId = await stageRawBatch(rows)
    await processImport(batchId) // hoàn tất sạch
    const once = await batchOutcome(batchId)
    expect(once.distinctLeads).toBe(expected.leads)
    expect(once.sources).toBe(expected.sources)

    // Mô phỏng job bị giao lại: reset về processing rồi chạy lại toàn bộ.
    await getDrizzle().update(importBatches).set({ status: 'processing' }).where(eq(importBatches.id, batchId))
    await processImport(batchId)
    const twice = await batchOutcome(batchId)
    expect(twice.distinctLeads, 'leads không đổi sau re-run').toBe(once.distinctLeads)
    expect(twice.sources, 'sources không đổi sau re-run (NOT EXISTS guard)').toBe(once.sources)
  })
})
