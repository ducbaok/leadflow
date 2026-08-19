import { type NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { leads } from '@/db/schema'
import { leadCsvHeaderLine, leadCsvRowLine, type LeadCsvRow } from '@/lib/export/csv'
import { buildLeadsOrderBy, buildLeadsWhere, parseLeadsQuery } from '../_shared'

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
    })
    .from(leads)
    .where(where)
    .orderBy(...buildLeadsOrderBy(q))

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // BOM UTF-8 để Excel nhận đúng encoding cho dữ liệu tiếng Việt.
      controller.enqueue(encoder.encode('﻿'))
      controller.enqueue(encoder.encode(leadCsvHeaderLine() + '\r\n'))
      for (const r of rows) {
        const row: LeadCsvRow = {
          ...r,
          // Score fields để null ở Batch 1 (luồng E điền sau) — cột CSV vẫn ổn định.
          ruleScore: null,
          aiScore: null,
          aiReason: null,
        }
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
