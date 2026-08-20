// Runner cho AC-14 (kill-worker). Chạy như tiến trình CON: thực thi import THẬT (processImport =
// normalizeStaging theo lô + promoteBatch set-based + finalize + audit) cho batchId truyền qua argv.
// Test cha SIGKILL tiến trình này giữa chừng để mô phỏng "job chết khi đang import 10k" (ADR-003),
// rồi chạy lại và so kết quả cuối. Không đi qua pg-boss — gọi thẳng processImport cho tất định.
//
// Chạy: node --import tsx tests/integration/helpers/promote-runner.mts <batchId>
// (tsx resolve alias '@' theo tsconfig; DATABASE_URL lấy từ process.env do test cha truyền vào.)
import { processImport } from '@/lib/import/process'
import { getSql } from '@/db/client'

const batchId = process.argv[2]
if (!batchId) {
  console.error('promote-runner: thiếu batchId')
  process.exit(2)
}

try {
  // Báo "đã bắt đầu" để test cha biết tiến trình đang chạy trước khi kill.
  console.log('RUNNER_STARTED')
  await processImport(batchId)
  console.log('RUNNER_DONE')
  await getSql().end({ timeout: 5 })
  process.exit(0)
} catch (err) {
  console.error('RUNNER_ERROR', err instanceof Error ? err.message : String(err))
  process.exit(1)
}
