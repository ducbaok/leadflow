import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/db/client'
import { leadScores, leads, scoringConfig } from '@/db/schema'
import { sendJob } from '@/jobs/boss'
import { JOB } from '@/jobs/contracts'
import { logAudit } from '@/lib/audit'
import { AI_CHUNK_SIZE, DEFAULT_AI_TOP_N } from '@/lib/scoring/constants'

// Luồng C sở hữu. Contract: docs/sot/40-api-contracts.md §Scoring.
// `enqueued` = số LEAD đưa vào hàng đợi chấm (rule: lead active; ai: top-N đã chọn).
//
// Audit: route này KHÔNG tự mutate dữ liệu (chỉ enqueue) — kết quả chấm được job ghi audit
// (`scoring.rules_scored` / `scoring.ai_scored`, scoring.job.ts). Vẫn ghi `scoring.run_requested`
// ở đây để lưu Ý ĐỊNH: job có thể chết hoặc nằm hàng đợi, mà mỗi lần chấm AI là tốn tiền API.
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ kind: z.enum(['rule', 'ai']) })

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'kind phải là "rule" hoặc "ai"' }, { status: 400 })
  }
  const db = getDb()

  if (parsed.data.kind === 'rule') {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(isNull(leads.archivedAt))
    await sendJob(JOB.scoreRules, {})
    await logAudit(db, {
      entity: 'scoring_config',
      entityId: '1',
      action: 'scoring.run_requested',
      payload: { kind: 'rule', enqueued: count },
    })
    return NextResponse.json({ ok: true, enqueued: count })
  }

  // kind === 'ai': chọn top-N lead active theo rule score, chunk ≤25/job.
  const cfg = (await db.select().from(scoringConfig).where(eq(scoringConfig.id, 1)).limit(1))[0]
  const topN = cfg?.aiTopN ?? DEFAULT_AI_TOP_N

  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .leftJoin(leadScores, and(eq(leadScores.leadId, leads.id), eq(leadScores.kind, 'rule')))
    .where(isNull(leads.archivedAt))
    .orderBy(sql`${leadScores.score} desc nulls last`, desc(leads.createdAt))
    .limit(topN)

  const ids = rows.map((r) => r.id)
  let enqueued = 0
  for (let i = 0; i < ids.length; i += AI_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + AI_CHUNK_SIZE)
    await sendJob(JOB.scoreAi, { leadIds: chunk })
    enqueued += chunk.length
  }

  await logAudit(db, {
    entity: 'scoring_config',
    entityId: '1',
    action: 'scoring.run_requested',
    payload: { kind: 'ai', enqueued, topN, chunks: Math.ceil(ids.length / AI_CHUNK_SIZE) },
  })

  return NextResponse.json({ ok: true, enqueued })
}
