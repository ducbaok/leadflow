import type { PgBoss } from 'pg-boss'
import { JOB, type JobPayload } from './contracts'

/**
 * Luồng A (Batch 1) cài đặt thân worker này.
 * Contract (tên job, payload) đã đóng băng — xem docs/sot/40-api-contracts.md.
 */
export async function registerImportWorker(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.importProcess>>(JOB.importProcess, async (jobs) => {
    for (const job of jobs) {
      console.warn(`[jobs] ${JOB.importProcess} chưa được cài đặt (Batch 1 — luồng A). batchId=${job.data.batchId}`)
    }
  })
}
