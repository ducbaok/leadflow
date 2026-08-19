import type { PgBoss } from 'pg-boss'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { importBatches } from '@/db/schema'
import { logAudit } from '@/lib/audit'
import { processImport } from '@/lib/import/process'
import { JOB, jobPayloads, type JobPayload } from './contracts'

/**
 * Luồng A (Batch 1): xử lý import batch.
 * Contract (tên job, payload) đóng băng ở Batch 0 — xem docs/sot/40-api-contracts.md.
 * Cuối import.process → enqueue dedupe.scan (luồng D xử lý).
 */
export async function registerImportWorker(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.importProcess>>(JOB.importProcess, async (jobs) => {
    for (const job of jobs) {
      const { batchId } = job.data
      try {
        await processImport(batchId)
        // Kích hoạt fuzzy scan cho batch vừa import (gửi trực tiếp qua instance để tránh
        // vòng import boss.ts ↔ import.job.ts; payload vẫn validate qua contract).
        await boss.send(JOB.dedupeScan, jobPayloads[JOB.dedupeScan].parse({ batchId }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[jobs] ${JOB.importProcess} lỗi batchId=${batchId}:`, err)
        const db = getDb()
        await db
          .update(importBatches)
          .set({ status: 'failed', error: message, finishedAt: new Date() })
          .where(eq(importBatches.id, batchId))
        await logAudit(db, {
          entity: 'import_batch',
          entityId: batchId,
          action: 'import.failed',
          payload: { error: message },
        })
        // Còn lượt retry → ném lại để pg-boss thử lại (re-run idempotent, ADR-003).
        const retryCount = (job as { retryCount?: number }).retryCount ?? 0
        if (retryCount < 3) throw err
      }
    }
  })
}
