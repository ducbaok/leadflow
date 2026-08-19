import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>
// Kiểu transaction lấy từ chữ ký của db.transaction — dùng cho helper nhận cả db lẫn tx
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

// Cache trên globalThis để dev hot-reload không mở thêm connection pool
const g = globalThis as unknown as { __sql?: ReturnType<typeof postgres>; __db?: Db }

export function getSql() {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL chưa được đặt (xem .env.example)')
    // Supavisor session mode không hỗ trợ prepared statements → prepare: false
    g.__sql = postgres(url, { prepare: false, max: 10, onnotice: () => {} })
  }
  return g.__sql
}

// Lazy: không mở kết nối lúc import module (next build import route mà không có env)
export function getDb(): Db {
  if (!g.__db) {
    g.__db = drizzle(getSql(), { schema })
  }
  return g.__db
}
