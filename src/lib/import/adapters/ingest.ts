import { eq } from 'drizzle-orm'
import { getDb, type Db } from '@/db/client'
import { importBatches, importRows } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { processImport } from '../process'
import type { SourceAdapter } from './types'

// Chạy một SourceAdapter qua ĐÚNG pipeline staging import_rows đã có của luồng A:
//   1. tạo import_batch (pending, đã gắn mapping của adapter)
//   2. bulk insert AdapterRawRow vào import_rows (raw jsonb + row_number) — như parse.ts làm với CSV
//   3. processImport(): normalize staging + promote SET-BASED (exact dedupe + upsert)
// KHÔNG viết đường ghi `leads` riêng — promote lo dedupe/upsert. Đây là điểm chứng minh
// adapter interface đúng: đổi nguồn = đổi mỗi adapter, pipeline giữ nguyên.

const STAGE_CHUNK = 1000 // số dòng mỗi lần insert vào import_rows (khớp parse.ts)

export type AdapterIngestResult = {
  batchId: string
  totalRows: number
  validRows: number
  errorRows: number
  insertedLeads: number
  updatedLeads: number
}

export async function ingestViaAdapter(
  adapter: SourceAdapter,
  options?: { limit?: number },
  db: Db = getDb(),
): Promise<AdapterIngestResult> {
  const rows = await adapter.fetchRows(options)

  // (1) Batch 'pending' + mapping — processImport đọc mapping từ đây.
  const [batch] = await db
    .insert(importBatches)
    .values({
      filename: adapter.label,
      sourceType: adapter.sourceType,
      status: 'pending',
      mapping: adapter.mapping,
      totalRows: rows.length,
    })
    .returning({ id: importBatches.id })
  const batchId = batch.id

  await logAudit(db, {
    entity: 'import_batch',
    entityId: batchId,
    action: 'import.uploaded',
    payload: { source: adapter.sourceType, totalRows: rows.length },
  })

  // (2) Bulk insert vào staging — raw jsonb, row_number 1-based (đồng nhất với parse.ts).
  for (let i = 0; i < rows.length; i += STAGE_CHUNK) {
    const chunk = rows.slice(i, i + STAGE_CHUNK).map((raw, k) => ({
      batchId,
      rowNumber: i + k + 1,
      raw,
    }))
    if (chunk.length) await db.insert(importRows).values(chunk)
  }

  // (3) Đi qua pipeline hiện có: normalize + promote set-based. Idempotent (ADR-003).
  await processImport(batchId)

  const [done] = await db
    .select({
      totalRows: importBatches.totalRows,
      validRows: importBatches.validRows,
      errorRows: importBatches.errorRows,
      insertedLeads: importBatches.insertedLeads,
      updatedLeads: importBatches.updatedLeads,
    })
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1)

  return {
    batchId,
    totalRows: done?.totalRows ?? rows.length,
    validRows: done?.validRows ?? 0,
    errorRows: done?.errorRows ?? 0,
    insertedLeads: done?.insertedLeads ?? 0,
    updatedLeads: done?.updatedLeads ?? 0,
  }
}
