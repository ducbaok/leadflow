import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { leads } from '@/db/schema'
import { closeDb, hasDb, withRollback, type Db } from './helpers/db'
import { FUZZY_PAIRS, leadCols, shouldFlag, type GoldenSide } from './helpers/golden'
import { dedupeScanImplemented, runDedupeScan } from './helpers/dedupe-adapter'

// AC-10 — Tầng 2 fuzzy flag.
// SoT: docs/sot/20-dedupe-spec.md §"Sinh candidate pairs". Chuẩn vàng: golden pairs kind=fuzzy.
//   duplicate|suspect → PHẢI có mặt trong dedupe_pairs;  not_duplicate → KHÔNG được xuất hiện.

afterAll(closeDb)

// ── Ngưỡng đóng băng trong SoT (20-dedupe-spec §"4 hằng số config"). ĐÂY LÀ BẢN SAO CHỈ-ĐỌC.
// Nếu luồng D tune lại và cập nhật SoT → cập nhật 4 số này cho khớp (điều kiện "khoá golden set").
const T1_NAME = 0.55
const T1_COMPANY = 0.3
const T2_NAME = 0.9
const T2_COMPANY = 0.2

// Câu sinh candidate của SoT, GIỚI HẠN vào đúng 2 lead vừa chèn (a.id < b.id) để không đụng
// 5k lead seed. Trả về hàng nếu cặp bị flag, rỗng nếu không.
async function candidatePair(tx: Db, idA: string, idB: string) {
  const rows = (await tx.execute(sql`
    SELECT a.id AS a_id, b.id AS b_id,
      similarity(a.full_name_sorted, b.full_name_sorted)::float AS name_sim,
      similarity(a.company_name_normalized, b.company_name_normalized)::float AS company_sim
    FROM leads a
    JOIN leads b ON a.id < b.id
    WHERE a.archived_at IS NULL AND b.archived_at IS NULL
      AND a.id IN (${idA}, ${idB}) AND b.id IN (${idA}, ${idB})
      AND (
        (similarity(a.full_name_sorted, b.full_name_sorted) >= ${T1_NAME}
          AND similarity(a.company_name_normalized, b.company_name_normalized) >= ${T1_COMPANY})
        OR
        (similarity(a.full_name_sorted, b.full_name_sorted) >= ${T2_NAME}
          AND similarity(a.company_name_normalized, b.company_name_normalized) >= ${T2_COMPANY})
      )
  `)) as unknown as { a_id: string; b_id: string; name_sim: number; company_sim: number }[]
  return rows
}

async function insertPair(tx: Db, a: GoldenSide, b: GoldenSide): Promise<[string, string]> {
  const inserted = await tx
    .insert(leads)
    .values([leadCols(a), leadCols(b)])
    .returning({ id: leads.id })
  return [inserted[0].id, inserted[1].id]
}

// ── AC-10 chính: quy tắc candidate của SoT + pg_trgm + normalize thật khớp golden set.
// Không phụ thuộc luồng D → luôn chạy (đây là "điều kiện dừng tuning": golden pass 100%).
describe.skipIf(!hasDb)('AC-10 golden fuzzy — quy tắc candidate SoT khớp golden set', () => {
  for (const pair of FUZZY_PAIRS) {
    const verb = shouldFlag(pair) ? 'PHẢI flag' : 'KHÔNG flag'
    it(`pair #${pair.id} (${pair.expected}) → ${verb}: ${pair.note}`, async () => {
      await withRollback(async (tx) => {
        const [idA, idB] = await insertPair(tx, pair.a, pair.b)
        const hits = await candidatePair(tx, idA, idB)
        expect(hits.length, `pair #${pair.id} flagged=${hits.length > 0}`).toBe(shouldFlag(pair) ? 1 : 0)
      })
    })
  }

  it('toàn bộ 12 cặp fuzzy khớp expected (tổng kết golden set)', async () => {
    const mismatches: string[] = []
    await withRollback(async (tx) => {
      for (const pair of FUZZY_PAIRS) {
        const [idA, idB] = await insertPair(tx, pair.a, pair.b)
        const flagged = (await candidatePair(tx, idA, idB)).length > 0
        if (flagged !== shouldFlag(pair)) mismatches.push(`#${pair.id}(${pair.expected})`)
      }
    })
    expect(mismatches, `cặp lệch kỳ vọng: ${mismatches.join(', ')}`).toEqual([])
  })
})

// ── AC-10 phần tích hợp luồng D: scan THẬT đổ dedupe_pairs. Skip cho tới khi D merge (xem adapter).
describe.skipIf(!hasDb || !dedupeScanImplemented())(
  'AC-10 fuzzy — scan THẬT của luồng D đổ dedupe_pairs (skip tới khi D merge)',
  () => {
    it('golden fuzzy pairs xuất hiện/vắng mặt trong dedupe_pairs đúng expected', async () => {
      await withRollback(async (tx) => {
        // Nạp toàn bộ golden fuzzy vào leads rồi chạy scan thật của D.
        const ids = new Map<number, [string, string]>()
        for (const pair of FUZZY_PAIRS) ids.set(pair.id, await insertPair(tx, pair.a, pair.b))
        await runDedupeScan(tx)

        for (const pair of FUZZY_PAIRS) {
          const [idA, idB] = ids.get(pair.id)!
          const found = (await tx.execute(sql`
            SELECT 1 FROM dedupe_pairs
            WHERE (lead_a_id = ${idA} AND lead_b_id = ${idB})
               OR (lead_a_id = ${idB} AND lead_b_id = ${idA})
          `)) as unknown as unknown[]
          expect(found.length > 0, `pair #${pair.id}`).toBe(shouldFlag(pair))
        }
      })
    })
  },
)
