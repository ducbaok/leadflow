import { and, count, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb } from '@/db/client'
import { dedupePairs, leadScores, leadSources, leads } from '@/db/schema'
import type { DedupeDecisionStatus, DedupeLeadSnapshot, DedupePair, DedupePairsResponse } from './types'

// GET /api/dedupe/pairs — hàng đợi review. Contract: docs/sot/40-api-contracts.md §Dedupe.

export type ListPairsOptions = {
  status: DedupeDecisionStatus
  page: number
  pageSize: number
}

// Alias hai phía của self-join để join leads hai lần cho một cặp.
const leadA = alias(leads, 'lead_a')
const leadB = alias(leads, 'lead_b')

// Cột lead cho snapshot. leadA/leadB là kiểu alias KHÁC NHAU (name literal khác) nên viết inline
// cho từng phía thay vì hàm dùng chung (giữ kiểu chặt, khỏi ép any).
const snapshotA = {
  id: leadA.id,
  fullName: leadA.fullName,
  email: leadA.email,
  companyName: leadA.companyName,
  title: leadA.title,
  industry: leadA.industry,
  companySize: leadA.companySize,
  phone: leadA.phone,
  phoneValid: leadA.phoneValid,
  status: leadA.status,
  createdAt: leadA.createdAt,
} as const

const snapshotB = {
  id: leadB.id,
  fullName: leadB.fullName,
  email: leadB.email,
  companyName: leadB.companyName,
  title: leadB.title,
  industry: leadB.industry,
  companySize: leadB.companySize,
  phone: leadB.phone,
  phoneValid: leadB.phoneValid,
  status: leadB.status,
  createdAt: leadB.createdAt,
} as const

type RawLead = {
  id: string
  fullName: string | null
  email: string | null
  companyName: string | null
  title: string | null
  industry: string | null
  companySize: number | null
  phone: string | null
  phoneValid: boolean | null
  status: DedupeLeadSnapshot['status']
  createdAt: Date
}

function toSnapshot(
  lead: RawLead,
  sourceCounts: Map<string, number>,
  scores: Map<string, { rule: number | null; ai: number | null }>,
): DedupeLeadSnapshot {
  const s = scores.get(lead.id)
  return {
    id: lead.id,
    fullName: lead.fullName,
    email: lead.email,
    companyName: lead.companyName,
    title: lead.title,
    industry: lead.industry,
    companySize: lead.companySize,
    phone: lead.phone,
    phoneValid: lead.phoneValid,
    status: lead.status,
    createdAt: lead.createdAt.toISOString(),
    sourceCount: sourceCounts.get(lead.id) ?? 0,
    ruleScore: s?.rule ?? null,
    aiScore: s?.ai ?? null,
  }
}

export async function listPairs(opts: ListPairsOptions): Promise<DedupePairsResponse> {
  const db = getDb()

  const conditions: SQL[] = [eq(dedupePairs.decision, opts.status)]
  // Hàng đợi review (pending) chỉ hiện cặp còn 2 lead active — bản đã merge biến mất khỏi dashboard.
  if (opts.status === 'pending') {
    conditions.push(isNull(leadA.archivedAt), isNull(leadB.archivedAt))
  }
  const where = and(...conditions)

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: dedupePairs.id,
        nameSimilarity: dedupePairs.nameSimilarity,
        companySimilarity: dedupePairs.companySimilarity,
        createdAt: dedupePairs.createdAt,
        a: snapshotA,
        b: snapshotB,
      })
      .from(dedupePairs)
      .innerJoin(leadA, eq(leadA.id, dedupePairs.leadAId))
      .innerJoin(leadB, eq(leadB.id, dedupePairs.leadBId))
      .where(where)
      .orderBy(desc(dedupePairs.createdAt), dedupePairs.id)
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db
      .select({ value: count() })
      .from(dedupePairs)
      .innerJoin(leadA, eq(leadA.id, dedupePairs.leadAId))
      .innerJoin(leadB, eq(leadB.id, dedupePairs.leadBId))
      .where(where),
  ])

  const total = totalRow[0]?.value ?? 0
  if (rows.length === 0) return { pairs: [], total }

  // Số nguồn + điểm cho mọi lead trong trang (≤ 2·pageSize lead) bằng 2 truy vấn gộp.
  const leadIds = [...new Set(rows.flatMap((r) => [r.a.id, r.b.id]))]

  const [srcRows, scoreRows] = await Promise.all([
    db
      .select({ leadId: leadSources.leadId, n: count() })
      .from(leadSources)
      .where(inArray(leadSources.leadId, leadIds))
      .groupBy(leadSources.leadId),
    db
      .select({ leadId: leadScores.leadId, kind: leadScores.kind, score: leadScores.score })
      .from(leadScores)
      .where(inArray(leadScores.leadId, leadIds)),
  ])

  const sourceCounts = new Map(srcRows.map((r) => [r.leadId, r.n]))
  const scores = new Map<string, { rule: number | null; ai: number | null }>()
  for (const r of scoreRows) {
    const entry = scores.get(r.leadId) ?? { rule: null, ai: null }
    entry[r.kind] = r.score
    scores.set(r.leadId, entry)
  }

  const pairs: DedupePair[] = rows.map((r) => ({
    id: r.id,
    nameSimilarity: r.nameSimilarity,
    companySimilarity: r.companySimilarity,
    createdAt: r.createdAt.toISOString(),
    a: toSnapshot(r.a, sourceCounts, scores),
    b: toSnapshot(r.b, sourceCounts, scores),
  }))

  return { pairs, total }
}
