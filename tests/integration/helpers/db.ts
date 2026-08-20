import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

// Hạ tầng cho integration test chống Postgres THẬT.
// - Không có DATABASE_URL (vd. CI job "checks" không dựng Postgres, hoặc contributor chưa cấu hình
//   DB) → hasDb=false, mọi suite integration tự skip (describe.skipIf(!hasDb)).
// - Isolation chuẩn: withRollback() — chạy trong 1 transaction rồi luôn ROLLBACK (throw sentinel),
//   nên test KHÔNG để lại rác trong DB dev/seed. Dùng lại code thật của src/ (promote, normalize).
// - Vài test buộc phải COMMIT (route handler dùng getDb() riêng, không nhận tx) → tự dọn trong test.

export type Db = PostgresJsDatabase<typeof schema>

export const DATABASE_URL = process.env.DATABASE_URL
export const hasDb = Boolean(DATABASE_URL)

let _client: ReturnType<typeof postgres> | undefined
let _db: Db | undefined

/** Postgres-js client dùng chung cho cả session test (Supavisor session mode → prepare:false). */
export function getClient() {
  if (!_client) {
    if (!DATABASE_URL) throw new Error('DATABASE_URL chưa đặt — integration test lẽ ra đã skip')
    _client = postgres(DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} })
  }
  return _client
}

export function getDrizzle(): Db {
  if (!_db) _db = drizzle(getClient(), { schema })
  return _db
}

/** Đóng pool sau khi chạy xong (gọi trong afterAll) để vitest không treo chờ connection. */
export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 5 })
    _client = undefined
    _db = undefined
  }
}

class Rollback extends Error {}

/**
 * Chạy `fn` trong một transaction rồi LUÔN rollback — dù fn thành công hay assertion ném lỗi.
 * Mọi INSERT/UPDATE (kể cả promoteBatch thật) đều bị hoàn tác → DB sạch sau test.
 * Trả về giá trị fn trả (assertion nên đặt TRONG fn để chạy với dữ liệu của tx).
 */
export async function withRollback<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const db = getDrizzle()
  let result!: T
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx as unknown as Db)
      throw new Rollback()
    })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
  return result
}
