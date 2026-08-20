import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { startBoss } from '@/jobs/boss'

// Luồng G sở hữu. Contract: docs/sot/40-api-contracts.md §Ops.
// Route MIỄN SESSION (proxy.ts) vì healthcheck của Railway gọi không kèm cookie.
// Không lộ thông tin gì ngoài 3 boolean/enum — cố ý không trả version/env/host.
export const dynamic = 'force-dynamic'

export async function GET() {
  // startBoss() idempotent: instrumentation.ts đã gọi lúc boot, ở đây chỉ đọc lại promise đã cache.
  const [dbUp, boss] = await Promise.all([
    getDb()
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    startBoss().catch(() => null),
  ])

  const body = { ok: dbUp, db: dbUp ? 'up' : 'down', boss: boss ? 'up' : 'down' } as const
  return NextResponse.json(body, { status: dbUp ? 200 : 503 })
}
