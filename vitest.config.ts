import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // unit: thuần hàm, không DB. integration: chống Postgres thật (tự skip khi thiếu DATABASE_URL).
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup-env.ts'],
    // Integration test dùng chung 1 pool Postgres + tx rollback → chạy tuần tự cho ổn định,
    // tránh nhiều file đua nhau ghi/đọc cùng bảng. Unit test không bị ảnh hưởng.
    fileParallelism: false,
    // Import 10k + spawn worker (kill-worker test) có thể lâu hơn 5s mặc định.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
})
