/**
 * Chạy migration bằng drizzle-orm (RUNTIME dependency), KHÔNG dùng drizzle-kit.
 * Lý do: drizzle-kit là devDependency → không tồn tại trong image production (ADR-009).
 * Cùng bảng theo dõi (`drizzle.__drizzle_migrations`) và cùng journal với drizzle-kit,
 * nên DB đã migrate bằng drizzle-kit trước đó vẫn nhận đúng, không chạy lại.
 *
 * Dùng: npm run db:migrate   (local đọc .env.local; Railway đọc env của service)
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL chưa được đặt (xem .env.example)')
  process.exit(1)
}

// max:1 — migration chạy tuần tự; prepare:false vì Supavisor session mode không hỗ trợ prepared statements
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  console.log('✓ Migrations đã áp dụng')
} catch (err) {
  console.error('✗ Migrate thất bại:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
