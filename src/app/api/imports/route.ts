import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { importBatches } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { guessMapping } from '@/lib/import/guess-mapping'
import { MAX_UPLOAD_BYTES, parseAndStage } from '@/lib/import/parse'

// SoT contract: docs/sot/40-api-contracts.md §Imports
// POST /api/imports  → parse + đổ thô vào import_rows, batch 'pending'
// GET  /api/imports  → danh sách batch (lịch sử import)

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Body phải là multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu trường "file"' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'File rỗng' }, { status: 400 })
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File vượt giới hạn 20MB (${(file.size / 1024 / 1024).toFixed(1)}MB)` },
      { status: 413 },
    )
  }
  const filename = file.name || 'upload.csv'
  const looksCsv = /\.csv$/i.test(filename) || /csv|text\/plain/i.test(file.type || '')
  if (!looksCsv) return NextResponse.json({ error: 'Chỉ nhận file .csv' }, { status: 415 })

  const db = getDb()
  const [batch] = await db
    .insert(importBatches)
    .values({ filename, sourceType: 'csv', status: 'pending' })
    .returning({ id: importBatches.id })
  const batchId = batch.id

  try {
    const { headers, preview, totalRows } = await parseAndStage(file, db, batchId)
    if (headers.length === 0) {
      await db.update(importBatches).set({ status: 'failed', error: 'CSV không có header' }).where(eq(importBatches.id, batchId))
      return NextResponse.json({ error: 'CSV rỗng hoặc không có dòng header' }, { status: 422 })
    }
    await db.update(importBatches).set({ totalRows }).where(eq(importBatches.id, batchId))
    await logAudit(db, {
      entity: 'import_batch',
      entityId: batchId,
      action: 'import.uploaded',
      payload: { filename, totalRows },
    })
    return NextResponse.json({ batchId, headers, preview, guessedMapping: guessMapping(headers) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(importBatches).set({ status: 'failed', error: message }).where(eq(importBatches.id, batchId))
    return NextResponse.json({ error: `Parse CSV thất bại: ${message}` }, { status: 422 })
  }
}

export async function GET() {
  const db = getDb()
  const batches = await db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      sourceType: importBatches.sourceType,
      status: importBatches.status,
      totalRows: importBatches.totalRows,
      validRows: importBatches.validRows,
      errorRows: importBatches.errorRows,
      insertedLeads: importBatches.insertedLeads,
      updatedLeads: importBatches.updatedLeads,
      durationMs: importBatches.durationMs,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(50)
  return NextResponse.json({ batches })
}
