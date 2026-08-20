import { and, eq } from 'drizzle-orm'
import { type NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { leads } from '@/db/schema'
import { leadCsvHeaderLine, leadCsvRowLine, type LeadCsvRow } from '@/lib/export/csv'
import { aiScores, buildLeadsOrderBy, buildLeadsWhere, parseLeadsQuery, ruleScores } from '../_shared'

// GET /api/leads/export — CSV stream theo ĐÚNG filter hiện hành (bỏ page/pageSize).
// Contract: docs/sot/40-api-contracts.md §Leads. Escape formula injection nằm ở @/lib/export/csv.

export async function GET(request: NextRequest) {
  const db = getDb()
  const q = parseLeadsQuery(request.nextUrl.searchParams)
  const where = buildLeadsWhere(q)

  const rows = await db
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
    })
    .from(leads)
    // Join giống GET /api/leads: bắt buộc để sort theo ruleScore/aiScore hoạt động + xuất điểm thật.
    .leftJoin(ruleScores, and(eq(ruleScores.leadId, leads.id), eq(ruleScores.kind, 'rule')))
    .leftJoin(aiScores, and(eq(aiScores.leadId, leads.id), eq(aiScores.kind, 'ai')))
    .where(where)
    .orderBy(...buildLeadsOrderBy(q))

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // BOM UTF-8 để Excel nhận đúng encoding cho dữ liệu tiếng Việt.
      controller.enqueue(encoder.encode('﻿'))
      controller.enqueue(encoder.encode(leadCsvHeaderLine() + '\r\n'))
      for (const r of rows) {
        // Batch 2 (luồng E): điểm thật từ join lead_scores (null nếu chưa chấm).
        const row: LeadCsvRow = r
        controller.enqueue(encoder.encode(leadCsvRowLine(row) + '\r\n'))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="leads-export.csv"',
      'Cache-Control': 'no-store',
    },
  })
}
