/**
 * Chạy MỘT LẦN khi Next.js server khởi động (trước khi nhận request).
 * Đây là điểm mấu chốt của kiến trúc "1 process": pg-boss worker sống
 * chung process với Next.js — không cần worker service riêng.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBoss } = await import('./jobs/boss')
    await startBoss()
  }
}
