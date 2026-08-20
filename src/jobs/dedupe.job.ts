import type { PgBoss } from 'pg-boss'
import { scanForDuplicates } from '@/lib/dedupe/scan'
import { JOB, type JobPayload } from './contracts'

/**
 * Luồng D (Batch 2) — worker cho queue `dedupe.scan`.
 * Contract (tên job, payload) đóng băng ở Batch 0 — xem docs/sot/40-api-contracts.md.
 * Gửi bởi: POST /api/dedupe/scan (toàn cục) và cuối import.process (theo batch).
 *
 * Scan idempotent (ON CONFLICT DO NOTHING) → job chết giữa chừng chạy lại vô hại; lỗi cứ ném để
 * pg-boss retry (retryLimit 3, backoff — cấu hình chung ở boss.ts).
 */
export async function registerDedupeWorker(boss: PgBoss) {
  await boss.work<JobPayload<typeof JOB.dedupeScan>>(JOB.dedupeScan, async (jobs) => {
    for (const job of jobs) {
      const { batchId } = job.data
      const flagged = await scanForDuplicates(batchId)
      console.log(`[jobs] ${JOB.dedupeScan} xong: +${flagged} cặp mới (scope=${batchId ?? 'global'})`)
    }
  })
}
