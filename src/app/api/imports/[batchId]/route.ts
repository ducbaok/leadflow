import { NextResponse } from 'next/server'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { importBatches, importRows } from '@/db/schema'

// GET /api/imports/:batchId → batch + errors[] (tối đa 100). Nguồn cho progress polling.
// SoT contract: docs/sot/40-api-contracts.md §Imports

export async function GET(_request: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await ctx.params
  const db = getDb()

  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1)
  if (!batch) return NextResponse.json({ error: 'Import batch không tồn tại' }, { status: 404 })

  const errorRows = await db
    .select({ rowNumber: importRows.rowNumber, message: importRows.validationError })
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), isNotNull(importRows.validationError)))
    .orderBy(asc(importRows.rowNumber))
    .limit(100)

  return NextResponse.json({
    id: batch.id,
    filename: batch.filename,
    sourceType: batch.sourceType,
    status: batch.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    errorRows: batch.errorRows,
    insertedLeads: batch.insertedLeads,
    updatedLeads: batch.updatedLeads,
    durationMs: batch.durationMs,
    error: batch.error,
    createdAt: batch.createdAt,
    errors: errorRows.map((e) => ({ rowNumber: e.rowNumber, message: e.message })),
  })
}
