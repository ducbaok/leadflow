import { z } from 'zod'

// ============================================================
// Job contract = bề mặt chung giữa các luồng song song.
// Tên job + payload schema được đóng băng ở Batch 0.
// Tài liệu: docs/sot/40-api-contracts.md — đổi ở đây phải đổi ở đó (quy tắc CLAUDE.md)
// ============================================================

// Lưu ý: pg-boss v12 chỉ cho phép [a-zA-Z0-9_\-./] trong tên queue → dùng '.' không dùng ':'
export const JOB = {
  /** Luồng A — xử lý một import batch: parse → staging → validate → promote */
  importProcess: 'import.process',
  /** Luồng D — quét cặp nghi trùng bằng pg_trgm (toàn cục hoặc theo batch) */
  dedupeScan: 'dedupe.scan',
  /** Luồng C — chấm điểm rule-based (miễn phí, set-based) */
  scoreRules: 'score.rules',
  /** Luồng C — chấm điểm AI cho danh sách lead (đã lọc top-N, có cache theo hash) */
  scoreAi: 'score.ai',
} as const

export type JobName = (typeof JOB)[keyof typeof JOB]

export const jobPayloads = {
  [JOB.importProcess]: z.object({ batchId: z.string().uuid() }),
  [JOB.dedupeScan]: z.object({ batchId: z.string().uuid().optional() }),
  [JOB.scoreRules]: z.object({ leadIds: z.array(z.string().uuid()).optional() }),
  [JOB.scoreAi]: z.object({ leadIds: z.array(z.string().uuid()) }),
} as const

export type JobPayload<N extends JobName> = z.infer<(typeof jobPayloads)[N]>
