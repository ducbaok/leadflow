import type { PgBoss } from 'pg-boss'
import { JOB, type JobPayload } from './contracts'

/**
 * Luồng C (Batch 1) cài đặt thân 2 worker này.
 * Contract (tên job, payload) đã đóng băng — xem docs/sot/40-api-contracts.md.
 */
export async function registerScoringWorkers(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.scoreRules>>(JOB.scoreRules, async (jobs) => {
    for (const job of jobs) {
      console.warn(`[jobs] ${JOB.scoreRules} chưa được cài đặt (Batch 1 — luồng C). leads=${job.data.leadIds?.length ?? 'all'}`)
    }
  })

  await boss.work<JobPayload<typeof JOB.scoreAi>>(JOB.scoreAi, async (jobs) => {
    for (const job of jobs) {
      console.warn(`[jobs] ${JOB.scoreAi} chưa được cài đặt (Batch 1 — luồng C). leads=${job.data.leadIds.length}`)
    }
  })
}
