import { count } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { leads } from '@/db/schema'
import { buildLeadsOrderBy, buildLeadsWhere, parseLeadsQuery } from './_shared'

// GET /api/leads — bảng lead server-side (sort/filter/pagination).
// Contract đóng băng: docs/sot/40-api-contracts.md §Leads.
// Score fields (ruleScore/aiScore/aiReason) trả null NGAY từ Batch 1; luồng E (Batch 2)
// join lead_scores vào mà KHÔNG đổi shape.
export async function GET(request: NextRequest) {
  const db = getDb()
  const q = parseLeadsQuery(request.nextUrl.searchParams)
  const where = buildLeadsWhere(q)

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: leads.id,
        fullName: leads.fullName,
        email: leads.email,
        companyName: leads.companyName,
        title: leads.title,
        industry: leads.industry,
        companySize: leads.companySize,
        phone: leads.phone,
        phoneValid: leads.phoneValid,
        status: leads.status,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(where)
      .orderBy(...buildLeadsOrderBy(q))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ value: count() }).from(leads).where(where),
  ])

  const total = totalRow[0]?.value ?? 0

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      // Placeholder — điền bởi luồng E ở Batch 2 (shape không đổi).
      ruleScore: null,
      aiScore: null,
      aiReason: null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
}
