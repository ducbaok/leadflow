import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { importBatches, importRows } from '@/db/schema'
import { promoteBatch } from '@/lib/import/promote'
import { closeDb, hasDb, withRollback, type Db } from './helpers/db'
import { EXACT_PAIRS, rawRow, stagedValues, toImportRowCols, type GoldenSide } from './helpers/golden'

// AC-9 — Tầng 1 exact dedupe "gom tự động khi import".
// SoT: docs/sot/20-dedupe-spec.md §"Tầng 1 — Exact"; golden pairs kind=exact.
// Chạy code THẬT của luồng A (normalizeMappedRow + promoteBatch: upsert ON CONFLICT email_normalized)
// trong 1 transaction rồi rollback → không để lại rác trong DB.

afterAll(closeDb)

async function stageBatch(tx: Db, sides: GoldenSide[]): Promise<string> {
  const [b] = await tx
    .insert(importBatches)
    .values({ filename: 'golden-exact.csv', sourceType: 'csv', status: 'processing', mapping: {} })
    .returning({ id: importBatches.id })
  await tx.insert(importRows).values(
    sides.map((side, i) => ({
      batchId: b.id,
      rowNumber: i + 1,
      raw: rawRow(side),
      ...toImportRowCols(stagedValues(side)),
    })),
  )
  return b.id
}

async function countDistinctLeads(tx: Db, batchId: string): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT count(DISTINCT lead_id)::int AS d
    FROM import_rows WHERE batch_id = ${batchId} AND validation_error IS NULL
  `)) as unknown as { d: number }[]
  return r[0]?.d ?? 0
}

async function countSources(tx: Db, batchId: string): Promise<number> {
  const r = (await tx.execute(sql`
    SELECT count(*)::int AS c FROM lead_sources WHERE import_batch_id = ${batchId}
  `)) as unknown as { c: number }[]
  return r[0]?.c ?? 0
}

describe.skipIf(!hasDb)('AC-9 golden exact — gom lead theo email_normalized khi import', () => {
  for (const pair of EXACT_PAIRS) {
    it(`pair #${pair.id}: "${pair.a.email}" + "${pair.b.email}" → 1 lead (${pair.note})`, async () => {
      // Tiền đề fixture: hai email PHẢI normalize về cùng một giá trị (khác null).
      const na = stagedValues(pair.a).email_normalized
      const nb = stagedValues(pair.b).email_normalized
      expect(na, 'email A normalize được').not.toBeNull()
      expect(nb, `email A(${na}) == email B`).toBe(na)

      await withRollback(async (tx) => {
        const batchId = await stageBatch(tx, [pair.a, pair.b])
        const counts = await promoteBatch(tx, batchId, 'csv')

        // Hai dòng khác nhau nhưng trùng email chuẩn hoá → đúng 1 lead, ghi 2 nguồn.
        expect(await countDistinctLeads(tx, batchId)).toBe(1)
        expect(await countSources(tx, batchId)).toBe(2)
        expect(counts.inserted).toBe(1)
        expect(counts.updated).toBe(0)
      })
    })
  }

  it('idempotent: promote LẠI cùng batch không tạo lead/nguồn trùng (ADR-003)', async () => {
    const pair = EXACT_PAIRS[0]
    await withRollback(async (tx) => {
      const batchId = await stageBatch(tx, [pair.a, pair.b])
      await promoteBatch(tx, batchId, 'csv')
      const second = await promoteBatch(tx, batchId, 'csv')

      expect(await countDistinctLeads(tx, batchId)).toBe(1)
      expect(await countSources(tx, batchId)).toBe(2) // NOT EXISTS guard chặn ghi nguồn trùng
      expect(second.inserted).toBe(0) // lần 2: chỉ ON CONFLICT DO UPDATE, không lead mới
    })
  })

  it('re-import cùng dữ liệu bằng BATCH MỚI → 0 lead mới, nguồn ghi theo batch (AC-2)', async () => {
    const pair = EXACT_PAIRS[0]
    await withRollback(async (tx) => {
      const b1 = await stageBatch(tx, [pair.a, pair.b])
      const r1 = await promoteBatch(tx, b1, 'csv')
      const b2 = await stageBatch(tx, [pair.a, pair.b])
      const r2 = await promoteBatch(tx, b2, 'csv')

      expect(r1.inserted).toBe(1)
      expect(r2.inserted).toBe(0) // batch 2 conflict hết vào lead cũ
      // Mỗi batch ghi nguồn riêng, tất cả trỏ về cùng 1 lead.
      expect(await countDistinctLeads(tx, b1)).toBe(1)
      expect(await countDistinctLeads(tx, b2)).toBe(1)
      const sameLead = (await tx.execute(sql`
        SELECT count(DISTINCT lead_id)::int AS d FROM import_rows WHERE batch_id IN (${b1}, ${b2})
      `)) as unknown as { d: number }[]
      expect(sameLead[0].d).toBe(1)
    })
  })
})
