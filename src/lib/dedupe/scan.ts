import { sql } from 'drizzle-orm'
import { getDb, type DbOrTx } from '@/db/client'
import { logAudit } from '@/lib/audit'
import { DEDUPE_THRESHOLDS, NAME_PRUNE_THRESHOLD } from './constants'

// Candidate scan (SoT 20-dedupe-spec.md §Tầng 2) — chạy SET-BASED TRONG Postgres bằng pg_trgm.
// KHÔNG string-similarity phía app (brief §3.1: O(n²) app-side vỡ ở 10k lead).

/**
 * Quét cặp nghi trùng và insert vào `dedupe_pairs` (chỉ cặp MỚI).
 *
 * Cơ chế:
 * - Self-join `a.id < b.id`; toán tử `%` lọc theo GIN index `leads_full_name_sorted_trgm_idx`.
 *   Ngưỡng của `%` set qua `set_config(..., is_local=true)` → chỉ trong transaction này, KHÔNG rò
 *   sang query khác dùng chung connection pool.
 * - Điều kiện chính xác (2 tier) áp lại bằng `similarity() >=` trong WHERE, dùng CÙNG hằng số với
 *   bản tham chiếu `candidateTier` (constants.ts).
 * - pair_hash = sha256(min:max) UNIQUE → `ON CONFLICT DO NOTHING`: cặp đã tồn tại (kể cả đã quyết
 *   merged/not_duplicate) không bao giờ bị re-flag (idempotency — AC-12).
 * - Chỉ xét lead active (`archived_at IS NULL`): bản đã archive sau merge không sinh cặp mới.
 *
 * @param batchId thiếu = quét toàn cục; có = chỉ cặp có ít nhất một lead thuộc batch (rẻ khi import).
 * @param db executor tùy chọn — integration test (luồng F) truyền transaction của nó vào để scan
 *   thấy dữ liệu chưa commit và rollback sạch; mặc định pool app (transaction lồng = savepoint).
 * @returns số cặp MỚI được flag.
 */
export async function scanForDuplicates(batchId?: string, db: DbOrTx = getDb()): Promise<number> {
  const { T1_NAME, T1_COMPANY, T2_NAME, T2_COMPANY } = DEDUPE_THRESHOLDS

  return db.transaction(async (tx) => {
    // Transaction-local: rollback/commit xong ngưỡng trở lại mặc định trên connection.
    await tx.execute(
      sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(NAME_PRUNE_THRESHOLD)}, true)`,
    )

    const batchFilter = batchId
      ? sql`AND (
          a.id IN (SELECT lead_id FROM lead_sources WHERE import_batch_id = ${batchId})
          OR b.id IN (SELECT lead_id FROM lead_sources WHERE import_batch_id = ${batchId})
        )`
      : sql``

    const result = await tx.execute(sql`
      WITH ins AS (
        INSERT INTO dedupe_pairs (pair_hash, lead_a_id, lead_b_id, name_similarity, company_similarity)
        SELECT
          encode(sha256(convert_to(a.id::text || ':' || b.id::text, 'UTF8')), 'hex'),
          a.id,
          b.id,
          similarity(a.full_name_sorted, b.full_name_sorted),
          similarity(a.company_name_normalized, b.company_name_normalized)
        FROM leads a
        JOIN leads b
          ON a.id < b.id
          AND a.full_name_sorted % b.full_name_sorted
        WHERE a.archived_at IS NULL AND b.archived_at IS NULL
          AND a.full_name_sorted IS NOT NULL AND b.full_name_sorted IS NOT NULL
          AND a.company_name_normalized IS NOT NULL AND b.company_name_normalized IS NOT NULL
          ${batchFilter}
          AND (
            (
              similarity(a.full_name_sorted, b.full_name_sorted) >= ${T1_NAME}
              AND similarity(a.company_name_normalized, b.company_name_normalized) >= ${T1_COMPANY}
            )
            OR (
              similarity(a.full_name_sorted, b.full_name_sorted) >= ${T2_NAME}
              AND similarity(a.company_name_normalized, b.company_name_normalized) >= ${T2_COMPANY}
            )
          )
        ON CONFLICT (pair_hash) DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM ins
    `)

    const flagged = (result as unknown as { n: number }[])[0]?.n ?? 0

    await logAudit(tx, {
      entity: 'dedupe_pair',
      action: 'dedupe.scanned',
      payload: { scope: batchId ?? 'global', flagged },
    })

    return flagged
  })
}
