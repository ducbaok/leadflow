import { and, count, eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { leads } from '@/db/schema'
import { aiScores, buildLeadsOrderBy, buildLeadsWhere, parseLeadsQuery, ruleScores } from './_shared'

// GET /api/leads — bảng lead server-side (sort/filter/pagination).
// Contract đóng băng: docs/sot/40-api-contracts.md §Leads.
// Batch 2 (luồng E): LEFT JOIN lead_scores (rule + ai) để đổ ruleScore/aiScore/aiReason THẬT,
// thêm aiStatus (additive, ADR-008) cho badge "Scoring…". Score NULL = chưa chấm.
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
        ruleScore: ruleScores.score,
        aiScore: aiScores.score,
        aiReason: aiScores.reason,
        aiStatus: aiScores.status,
      })
      .from(leads)
      // Join qua unique (lead_id, kind) → mỗi lead ≤ 1 bản mỗi kind, không nở dòng.
      .leftJoin(ruleScores, and(eq(ruleScores.leadId, leads.id), eq(ruleScores.kind, 'rule')))
      .leftJoin(aiScores, and(eq(aiScores.leadId, leads.id), eq(aiScores.kind, 'ai')))
      .where(where)
      .orderBy(...buildLeadsOrderBy(q))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    // Count chỉ trên leads (join không lọc) → tổng vẫn đúng, khỏi join thừa.
    db.select({ value: count() }).from(leads).where(where),
  ])

  const total = totalRow[0]?.value ?? 0

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      // aiStatus null = chưa từng chấm AI (không có bản kind='ai'); giữ nguyên nếu có.
      aiStatus: r.aiStatus ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
}
