import { auditLog } from '@/db/schema'
import type { DbOrTx } from '@/db/client'

export type AuditEntry = {
  entity: 'lead' | 'import_batch' | 'dedupe_pair' | 'scoring_config' | 'lead_score'
  entityId?: string
  action: string // vd: 'import.completed', 'lead.status_changed', 'dedupe.merged'
  payload?: Record<string, unknown>
}

/**
 * Ghi audit trail (non-functional requirement của brief).
 * Nhận cả db lẫn transaction — mutation nào chạy trong tx thì audit cùng tx đó.
 */
export async function logAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    payload: entry.payload,
  })
}
