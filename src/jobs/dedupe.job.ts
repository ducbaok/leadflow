import type { PgBoss } from 'pg-boss'
import { JOB, type JobPayload } from './contracts'

/**
 * Luồng D (Batch 2) cài đặt thân worker này.
 * Contract (tên job, payload) đã đóng băng — xem docs/sot/40-api-contracts.md.
 */
export async function registerDedupeWorker(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.dedupeScan>>(JOB.dedupeScan, async (jobs) => {
    for (const job of jobs) {
      console.warn(`[jobs] ${JOB.dedupeScan} chưa được cài đặt (Batch 2 — luồng D). batchId=${job.data.batchId ?? 'all'}`)
    }
  })
}
