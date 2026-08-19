import { and, asc, eq, isNull } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { importBatches, leadScores, leadSources, leads } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

// GET /api/leads/:id  +  PATCH /api/leads/:id — luồng B sở hữu.
// Contract: docs/sot/40-api-contracts.md §Leads.

const idSchema = z.string().uuid()
const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'won', 'lost']),
})

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await ctx.params).id)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
  const id = parsed.data
  const db = getDb()

  // Mặc định chỉ lead active (archived_at IS NULL) — instruction + SoT §Leads.
  const [lead] = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      email: leads.email,
      companyName: leads.companyName,
      title: leads.title,
      industry: leads.industry,
      companySize: leads.companySize,
      phone: leads.phone,
      phoneValid: leads.phoneValid,
      status: leads.status,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .limit(1)

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const [sources, scores] = await Promise.all([
    db
      .select({
        id: leadSources.id,
        sourceType: leadSources.sourceType,
        rowNumber: leadSources.rowNumber,
        rawData: leadSources.rawData,
        createdAt: leadSources.createdAt,
        batchFilename: importBatches.filename,
      })
      .from(leadSources)
      .innerJoin(importBatches, eq(leadSources.importBatchId, importBatches.id))
      .where(eq(leadSources.leadId, id))
      .orderBy(asc(leadSources.createdAt)),
    // Read-only: hiển thị điểm nếu luồng C đã chấm (Batch 1 thường rỗng). KHÔNG tính điểm ở đây.
    db
      .select({
        kind: leadScores.kind,
        score: leadScores.score,
        reason: leadScores.reason,
        model: leadScores.model,
        scoredAt: leadScores.scoredAt,
        status: leadScores.status,
      })
      .from(leadScores)
      .where(eq(leadScores.leadId, id)),
  ])

  return NextResponse.json({
    lead: {
      ...lead,
      createdAt: lead.createdAt.toISOString(),
      ruleScore: null,
      aiScore: null,
      aiReason: null,
    },
    sources: sources.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    scores: scores.map((s) => ({ ...s, scoredAt: s.scoredAt?.toISOString() ?? null })),
  })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsedId = idSchema.safeParse((await ctx.params).id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
  const id = parsedId.data

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsedBody = patchSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const nextStatus = parsedBody.data.status
  const db = getDb()

  const ok = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: leads.status })
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
      .limit(1)
    if (!current) return false

    await tx.update(leads).set({ status: nextStatus, updatedAt: new Date() }).where(eq(leads.id, id))
    await logAudit(tx, {
      entity: 'lead',
      entityId: id,
      action: 'lead.status_changed',
      payload: { from: current.status, to: nextStatus },
    })
    return true
  })

  if (!ok) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
