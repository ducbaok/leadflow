import { PgBoss } from 'pg-boss'
import { JOB, jobPayloads, type JobName, type JobPayload } from './contracts'
import { registerDedupeWorker } from './dedupe.job'
import { registerImportWorker } from './import.job'
import { registerScoringWorkers } from './scoring.job'

// Retry mặc định cho mọi queue: tối đa 3 lần, exponential backoff (spec: non-functional của brief)
const QUEUE_OPTIONS = { retryLimit: 3, retryBackoff: true, retryDelay: 5 }

// Cache trên globalThis: dev hot-reload không tạo thêm instance/polling
const g = globalThis as unknown as { __bossPromise?: Promise<PgBoss | null> }

/**
 * Khởi động pg-boss trong CÙNG process với Next.js (gọi từ src/instrumentation.ts).
 * Không có DATABASE_URL hoặc DB lỗi → trả null và log cảnh báo, KHÔNG crash app
 * (dev vẫn chạy UI được khi chưa cấu hình DB).
 */
export function startBoss(): Promise<PgBoss | null> {
  if (!g.__bossPromise) {
    g.__bossPromise = (async () => {
      const url = process.env.DATABASE_URL
      if (!url) {
        console.warn('[jobs] DATABASE_URL chưa đặt — pg-boss không khởi động, background jobs sẽ không chạy')
        return null
      }
      try {
        const boss = new PgBoss({ connectionString: url, max: 5 })
        boss.on('error', (err) => console.error('[pg-boss]', err))
        await boss.start()
        for (const name of Object.values(JOB)) {
          await boss.createQueue(name, QUEUE_OPTIONS)
        }
        await registerImportWorker(boss)
        await registerDedupeWorker(boss)
        await registerScoringWorkers(boss)
        console.log('[jobs] pg-boss đã khởi động, queues:', Object.values(JOB).join(', '))
        return boss
      } catch (err) {
        console.error('[jobs] pg-boss khởi động thất bại:', err)
        return null
      }
    })()
  }
  return g.__bossPromise
}

/** Gửi job với payload đã validate qua zod. Dùng hàm này thay vì boss.send trực tiếp. */
export async function sendJob<N extends JobName>(name: N, payload: JobPayload<N>): Promise<string | null> {
  const parsed = jobPayloads[name].parse(payload)
  const boss = await startBoss()
  if (!boss) throw new Error('pg-boss chưa khởi động (DATABASE_URL thiếu hoặc DB lỗi)')
  return boss.send(name, parsed)
}
