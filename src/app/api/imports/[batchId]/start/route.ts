import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db/client'
import { importBatches, mappingTemplates } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { LEAD_FIELDS, type ColumnMapping } from '@/lib/import/fields'
import { JOB } from '@/jobs/contracts'
import { sendJob } from '@/jobs/boss'

// POST /api/imports/:batchId/start → lưu mapping (+ template nếu có tên), enqueue import.process
// SoT contract: docs/sot/40-api-contracts.md §Imports

const startSchema = z.object({
  mapping: z.record(z.string(), z.enum(LEAD_FIELDS).nullable()),
  templateName: z.string().trim().min(1).max(100).optional(),
})

export async function POST(request: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await ctx.params

  const body = await request.json().catch(() => null)
  const parsed = startSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: `Body không hợp lệ: ${parsed.error.issues[0]?.message ?? 'mapping sai'}` }, { status: 400 })
  }
  const mapping = parsed.data.mapping as ColumnMapping
  const templateName = parsed.data.templateName

  if (!Object.values(mapping).some((f) => f)) {
    return NextResponse.json({ error: 'Cần map ít nhất một cột' }, { status: 400 })
  }

  const db = getDb()
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1)
  if (!batch) return NextResponse.json({ error: 'Import batch không tồn tại' }, { status: 404 })
  if (batch.status !== 'pending') {
    return NextResponse.json({ error: `Batch đã ở trạng thái "${batch.status}", không thể start lại` }, { status: 409 })
  }

  await db.update(importBatches).set({ mapping }).where(eq(importBatches.id, batchId))

  if (templateName) {
    await db
      .insert(mappingTemplates)
      .values({ name: templateName, mapping })
      .onConflictDoUpdate({ target: mappingTemplates.name, set: { mapping } })
  }

  await logAudit(db, {
    entity: 'import_batch',
    entityId: batchId,
    action: 'import.mapping_saved',
    payload: { mapping, templateName: templateName ?? null },
  })

  await sendJob(JOB.importProcess, { batchId })

  return NextResponse.json({ ok: true })
}
