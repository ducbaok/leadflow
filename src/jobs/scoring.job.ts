import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { getDb, type Db } from '@/db/client'
import { leadScores, leads, scoringConfig } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { buildAiInput } from '@/lib/scoring/ai-input'
import { createAnthropicClient, createAnthropicScorer } from '@/lib/scoring/ai-client'
import { runAiScoring, type AiScoreStore, type ExistingScore } from '@/lib/scoring/ai-runner'
import { resolveAiModel } from '@/lib/scoring/constants'
import { buildRuleScoreExpr } from '@/lib/scoring/rules-sql'
import { rulesConfigSchema } from '@/lib/scoring/schema'
import { JOB, type JobPayload } from './contracts'

// Luồng C (Batch 1) — thân 2 worker. Contract (tên job, payload) đóng băng: docs/sot/40-api-contracts.md.
// Spec chấm điểm: docs/sot/30-scoring-spec.md.

/**
 * score.rules — set-based: 1 câu INSERT ... SELECT ... ON CONFLICT chấm toàn bộ lead active
 * (hoặc theo leadIds). Không row-by-row qua ORM (30-scoring-spec §1).
 */
async function processRules(leadIds?: string[]): Promise<void> {
  const db = getDb()
  const cfgRow = (await db.select().from(scoringConfig).where(eq(scoringConfig.id, 1)).limit(1))[0]
  if (!cfgRow) {
    console.warn('[scoring] score.rules: chưa có scoring_config (id=1) — bỏ qua')
    return
  }
  const config = rulesConfigSchema.parse(cfgRow.rules)
  const scoreExpr = buildRuleScoreExpr(config)

  const idFilter =
    leadIds && leadIds.length
      ? sql` AND l.id IN (${sql.join(
          leadIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``

  await db.execute(sql`
    INSERT INTO lead_scores (lead_id, kind, score, status, scored_at, updated_at)
    SELECT l.id, 'rule'::score_kind, ${scoreExpr}, 'completed'::score_status, now(), now()
    FROM leads l
    WHERE l.archived_at IS NULL${idFilter}
    ON CONFLICT (lead_id, kind) DO UPDATE
    SET score = EXCLUDED.score, status = 'completed'::score_status, scored_at = now(), updated_at = now(), error = NULL
  `)

  await logAudit(db, {
    entity: 'scoring_config',
    entityId: '1',
    action: 'scoring.rules_scored',
    payload: { scope: leadIds?.length ? `${leadIds.length} leads` : 'all active' },
  })
}

/** Store ghi lead_scores(kind='ai') qua upsert (lead_id, kind). */
function makeDbStore(db: Db): AiScoreStore {
  return {
    async markPending(leadId, inputHash, model) {
      await db
        .insert(leadScores)
        .values({ leadId, kind: 'ai', status: 'pending', inputHash, model, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [leadScores.leadId, leadScores.kind],
          set: { status: 'pending', inputHash, model, error: null, updatedAt: new Date() },
        })
    },
    async saveCompleted(leadId, inputHash, model, score, reason) {
      const now = new Date()
      await db
        .insert(leadScores)
        .values({ leadId, kind: 'ai', status: 'completed', score, reason, inputHash, model, scoredAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [leadScores.leadId, leadScores.kind],
          set: { status: 'completed', score, reason, inputHash, model, error: null, scoredAt: now, updatedAt: now },
        })
    },
    async saveFailed(leadId, inputHash, model, error) {
      await db
        .insert(leadScores)
        .values({ leadId, kind: 'ai', status: 'failed', inputHash, model, error, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [leadScores.leadId, leadScores.kind],
          set: { status: 'failed', inputHash, model, error, updatedAt: new Date() },
        })
    },
  }
}

/**
 * score.ai — chấm AI cho 1 chunk lead (đã là top-N, ≤25). Cache theo input_hash (AC-7),
 * lỗi 1 lead → status='failed' + tiếp tục (AC-8). Retry transient: SDK maxRetries + pg-boss.
 */
async function processAi(leadIds: string[]): Promise<void> {
  if (!leadIds.length) return
  const client = createAnthropicClient()
  if (!client) {
    console.warn('[scoring] score.ai: ANTHROPIC_API_KEY trống — bỏ qua (job sẽ chạy được khi đã cấu hình key)')
    return
  }
  const db = getDb()
  const model = resolveAiModel()

  const cfgRow = (await db.select().from(scoringConfig).where(eq(scoringConfig.id, 1)).limit(1))[0]
  const icpDescription = cfgRow?.icpDescription ?? ''

  const leadRows = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      title: leads.title,
      companyName: leads.companyName,
      industry: leads.industry,
      companySize: leads.companySize,
      email: leads.email,
      emailNormalized: leads.emailNormalized,
      phoneValid: leads.phoneValid,
    })
    .from(leads)
    .where(and(inArray(leads.id, leadIds), isNull(leads.archivedAt)))
  if (!leadRows.length) return

  const inputs = leadRows.map((lead) => buildAiInput(lead, { model, icpDescription }))

  const existingRows = await db
    .select({ leadId: leadScores.leadId, inputHash: leadScores.inputHash, status: leadScores.status })
    .from(leadScores)
    .where(and(inArray(leadScores.leadId, leadIds), eq(leadScores.kind, 'ai')))
  const existing = new Map<string, ExistingScore>()
  for (const row of existingRows) existing.set(row.leadId, { inputHash: row.inputHash, status: row.status })

  const summary = await runAiScoring({
    inputs,
    existing,
    scorer: createAnthropicScorer(client, model),
    store: makeDbStore(db),
  })

  await logAudit(db, {
    entity: 'scoring_config',
    entityId: '1',
    action: 'scoring.ai_scored',
    payload: { model, ...summary },
  })
}

export async function registerScoringWorkers(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.scoreRules>>(JOB.scoreRules, async (jobs) => {
    for (const job of jobs) await processRules(job.data.leadIds)
  })

  await boss.work<JobPayload<typeof JOB.scoreAi>>(JOB.scoreAi, async (jobs) => {
    for (const job of jobs) await processAi(job.data.leadIds)
  })
}
