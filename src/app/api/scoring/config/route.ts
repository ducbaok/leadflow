import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { scoringConfig } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { sendJob } from '@/jobs/boss'
import { JOB } from '@/jobs/contracts'
import { DEFAULT_AI_TOP_N, DEFAULT_RULES } from '@/lib/scoring/constants'
import { scoringConfigUpdateSchema } from '@/lib/scoring/schema'

// Luồng C sở hữu. Contract: docs/sot/40-api-contracts.md §Scoring.
export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const row = (await db.select().from(scoringConfig).where(eq(scoringConfig.id, 1)).limit(1))[0]
  return NextResponse.json({
    icpDescription: row?.icpDescription ?? '',
    rules: row?.rules ?? DEFAULT_RULES,
    aiTopN: row?.aiTopN ?? DEFAULT_AI_TOP_N,
  })
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = scoringConfigUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: `Config không hợp lệ: ${parsed.error.issues[0]?.message ?? 'unknown'}` }, { status: 400 })
  }
  const { icpDescription, rules, aiTopN } = parsed.data

  // Chỉ set field được cung cấp (partial update singleton id=1).
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (icpDescription !== undefined) set.icpDescription = icpDescription
  if (rules !== undefined) set.rules = rules
  if (aiTopN !== undefined) set.aiTopN = aiTopN

  const db = getDb()
  await db
    .insert(scoringConfig)
    .values({
      id: 1,
      icpDescription: icpDescription ?? null,
      rules: rules ?? DEFAULT_RULES,
      aiTopN: aiTopN ?? DEFAULT_AI_TOP_N,
    })
    .onConflictDoUpdate({ target: scoringConfig.id, set })

  await logAudit(db, {
    entity: 'scoring_config',
    entityId: '1',
    action: 'scoring.config_updated',
    payload: { fields: Object.keys(set).filter((k) => k !== 'updatedAt') },
  })

  // Đổi rules → chấm lại rule toàn bộ (rẻ, set-based).
  if (rules !== undefined) {
    try {
      await sendJob(JOB.scoreRules, {})
    } catch (err) {
      console.warn('[scoring] không enqueue được score.rules sau khi đổi config:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
