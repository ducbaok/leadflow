import { and, eq, ne, or } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { dedupePairs, leadSources, leads } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import type { DedupeDecisionBody } from './types'

// State machine quyết định (SoT 20-dedupe-spec.md §State machine). Mọi bước trong MỘT transaction.

export type DecisionResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Áp một quyết định lên cặp pending.
 *
 * "merged" (keptLeadId = bản giữ):
 *  1. Bản thua → archived_at = now(), merged_into_id = keptLeadId.
 *  2. lead_sources của bản thua → repoint sang keptLeadId (giữ provenance).
 *  3. Mọi lead có merged_into_id = bản thua → forward sang keptLeadId (bất biến: merged_into luôn
 *     trỏ lead active).
 *  4. Cặp này → merged.
 *  5. Các cặp pending KHÁC chứa bản thua → tự động not_duplicate (lọc khỏi hàng đợi review — spec §4),
 *     kèm audit note.
 *  6. Audit `dedupe.merged` cho CẢ HAI lead.
 *
 * "not_duplicate": chỉ set decision — không bao giờ hỏi lại (pair_hash idempotent).
 *
 * Không có undo (đã cắt — 00-scope.md).
 */
export async function applyDecision(pairId: string, body: DedupeDecisionBody): Promise<DecisionResult> {
  const db = getDb()

  return db.transaction(async (tx) => {
    // Khoá hàng cặp: chống double-click / hai request đua nhau quyết cùng một cặp.
    const [pair] = await tx.select().from(dedupePairs).where(eq(dedupePairs.id, pairId)).limit(1).for('update')
    if (!pair) return { ok: false, status: 404, error: 'Pair not found' }
    if (pair.decision !== 'pending') return { ok: false, status: 409, error: 'Pair already decided' }

    const now = new Date()

    if (body.decision === 'not_duplicate') {
      await tx
        .update(dedupePairs)
        .set({ decision: 'not_duplicate', decidedAt: now })
        .where(eq(dedupePairs.id, pairId))
      await logAudit(tx, {
        entity: 'dedupe_pair',
        entityId: pairId,
        action: 'dedupe.not_duplicate',
        payload: { leadAId: pair.leadAId, leadBId: pair.leadBId },
      })
      return { ok: true }
    }

    // decision === 'merged'
    const { keptLeadId } = body
    if (keptLeadId !== pair.leadAId && keptLeadId !== pair.leadBId) {
      return { ok: false, status: 400, error: 'keptLeadId must be one of the pair leads' }
    }
    const losingLeadId = keptLeadId === pair.leadAId ? pair.leadBId : pair.leadAId

    // 1. Archive bản thua, trỏ merged_into về bản giữ.
    await tx
      .update(leads)
      .set({ archivedAt: now, mergedIntoId: keptLeadId, updatedAt: now })
      .where(eq(leads.id, losingLeadId))

    // 2. Repoint nguồn của bản thua sang bản giữ.
    await tx.update(leadSources).set({ leadId: keptLeadId }).where(eq(leadSources.leadId, losingLeadId))

    // 3. Forward mọi con trỏ merged_into_id cũ (bản thua từng là đích merge) → bản giữ.
    await tx.update(leads).set({ mergedIntoId: keptLeadId }).where(eq(leads.mergedIntoId, losingLeadId))

    // 4. Cặp này → merged.
    await tx
      .update(dedupePairs)
      .set({ decision: 'merged', keptLeadId, decidedAt: now })
      .where(eq(dedupePairs.id, pairId))

    // 5. Cặp pending KHÁC chứa bản thua → tự động not_duplicate (bản thua đã biến mất khỏi dashboard).
    const autoResolved = await tx
      .update(dedupePairs)
      .set({ decision: 'not_duplicate', decidedAt: now })
      .where(
        and(
          eq(dedupePairs.decision, 'pending'),
          ne(dedupePairs.id, pairId),
          or(eq(dedupePairs.leadAId, losingLeadId), eq(dedupePairs.leadBId, losingLeadId)),
        ),
      )
      .returning({ id: dedupePairs.id })

    if (autoResolved.length > 0) {
      await logAudit(tx, {
        entity: 'dedupe_pair',
        entityId: pairId,
        action: 'dedupe.auto_not_duplicate',
        payload: {
          reason: 'lead archived by merge',
          archivedLeadId: losingLeadId,
          pairIds: autoResolved.map((p) => p.id),
        },
      })
    }

    // 6. Audit cho CẢ HAI lead.
    await logAudit(tx, {
      entity: 'lead',
      entityId: keptLeadId,
      action: 'dedupe.merged',
      payload: { role: 'kept', pairId, archivedLeadId: losingLeadId },
    })
    await logAudit(tx, {
      entity: 'lead',
      entityId: losingLeadId,
      action: 'dedupe.merged',
      payload: { role: 'archived', pairId, keptLeadId },
    })

    return { ok: true }
  })
}
