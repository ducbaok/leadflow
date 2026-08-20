import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { logAudit } from '@/lib/audit'
import { seedDemoData } from '@/lib/demo/seed'

// Luồng G sở hữu. Contract: docs/sot/40-api-contracts.md §Ops. Lý do tồn tại: ADR-009.
//
// Route MIỄN SESSION (proxy.ts) — bảo vệ bằng ADMIN_RESET_TOKEN thay vì cookie, để gọi được
// bằng curl từ máy khác. Env chưa đặt = route coi như KHÔNG BẬT (503), không phải "cho qua".
// Cố ý không có UI: đây là hành động phá huỷ, không nên đặt cạnh nút bấm thường.
export const dynamic = 'force-dynamic'

/** So sánh chống timing attack. Khác độ dài → false luôn (timingSafeEqual ném nếu lệch length). */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const expected = process.env.ADMIN_RESET_TOKEN?.trim()
  if (!expected) {
    return NextResponse.json({ error: 'Reset endpoint chưa bật (thiếu ADMIN_RESET_TOKEN)' }, { status: 503 })
  }

  const provided = request.headers.get('x-admin-token') ?? ''
  if (!tokenMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()
  const result = await seedDemoData(db, (msg) => console.log('[reset]', msg))

  // Seed đã TRUNCATE audit_log, nên entry này là dòng đầu tiên của lịch sử mới — đúng ý:
  // nó đánh dấu mốc "dữ liệu bắt đầu lại từ đây". entity dùng 'import_batch' vì seed sinh
  // đúng một batch nguồn (không thêm entity mới vào src/lib/audit.ts — nền tảng dùng chung).
  await logAudit(db, { entity: 'import_batch', action: 'demo.reset', payload: { ...result } })

  return NextResponse.json({ ok: true, leads: result.leads })
}
