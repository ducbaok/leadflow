import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { getDb, type Db } from '@/db/client'
import { importBatches, importRows } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import type { ColumnMapping } from './fields'
import { invertMapping, normalizeMappedRow } from './normalize-row'
import { promoteBatch } from './promote'

// Orchestrator của job import.process (luồng A). Thứ tự: processing → normalize staging
// (JS, ghi lại bằng bulk SQL) → promote set-based → finalize + audit. Idempotent (ADR-003).

const NORMALIZE_CHUNK = 2000

/**
 * Đọc import_rows theo lô, normalize trong JS (dùng lại lib/normalize), ghi lại các cột
 * đã chuẩn hoá + validation_error bằng MỘT update set-based/lô qua jsonb_to_recordset.
 */
async function normalizeStaging(db: Db, batchId: string, mapping: ColumnMapping): Promise<void> {
  const inv = invertMapping(mapping)
  let lastId = 0
  for (;;) {
    const rows = await db
      .select({ id: importRows.id, raw: importRows.raw })
      .from(importRows)
      .where(and(eq(importRows.batchId, batchId), gt(importRows.id, lastId)))
      .orderBy(asc(importRows.id))
      .limit(NORMALIZE_CHUNK)
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id

    const values = rows.map((r) => ({
      id: r.id,
      ...normalizeMappedRow((r.raw ?? {}) as Record<string, unknown>, inv),
    }))

    await db.execute(sql`
      UPDATE import_rows AS ir SET
        email = v.email,
        email_normalized = v.email_normalized,
        full_name = v.full_name,
        full_name_normalized = v.full_name_normalized,
        full_name_sorted = v.full_name_sorted,
        company_name = v.company_name,
        company_name_normalized = v.company_name_normalized,
        title = v.title,
        industry = v.industry,
        company_size = v.company_size,
        phone = v.phone,
        phone_valid = v.phone_valid,
        validation_error = v.validation_error
      FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS v(
        id bigint, email text, email_normalized text, full_name text, full_name_normalized text,
        full_name_sorted text, company_name text, company_name_normalized text, title text,
        industry text, company_size integer, phone text, phone_valid boolean, validation_error text
      )
      WHERE ir.id = v.id
    `)

    if (rows.length < NORMALIZE_CHUNK) break
  }
}

/**
 * Xử lý một import batch từ đầu tới cuối. Ném lỗi nếu batch không tồn tại / chưa có mapping.
 * Gọi lại với batch đã 'completed' → no-op (idempotent).
 */
export async function processImport(batchId: string): Promise<void> {
  const db = getDb()
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1)
  if (!batch) throw new Error(`Import batch không tồn tại: ${batchId}`)
  if (batch.status === 'completed') return
  const mapping = batch.mapping as ColumnMapping | null
  if (!mapping) throw new Error(`Batch ${batchId} chưa có mapping — gọi /start trước`)

  const startedAt = new Date()
  await db
    .update(importBatches)
    .set({ status: 'processing', startedAt, error: null })
    .where(eq(importBatches.id, batchId))
  await logAudit(db, { entity: 'import_batch', entityId: batchId, action: 'import.started' })

  await normalizeStaging(db, batchId, mapping)
  const { inserted, updated } = await promoteBatch(db, batchId, batch.sourceType)

  const countRows = (await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE validation_error IS NULL)::int AS valid,
      count(*) FILTER (WHERE validation_error IS NOT NULL)::int AS errors
    FROM import_rows WHERE batch_id = ${batchId}
  `)) as unknown as { total: number; valid: number; errors: number }[]
  const counts = countRows[0] ?? { total: 0, valid: 0, errors: 0 }

  const finishedAt = new Date()
  await db
    .update(importBatches)
    .set({
      status: 'completed',
      totalRows: counts.total,
      validRows: counts.valid,
      errorRows: counts.errors,
      insertedLeads: inserted,
      updatedLeads: updated,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: null,
    })
    .where(eq(importBatches.id, batchId))

  await logAudit(db, {
    entity: 'import_batch',
    entityId: batchId,
    action: 'import.completed',
    payload: { total: counts.total, valid: counts.valid, errors: counts.errors, inserted, updated },
  })
}
