// Shape dùng chung server ↔ client cho luồng D. KHÔNG import runtime nào (client bundle được).
// Contract: docs/sot/40-api-contracts.md §Dedupe.

import type { LeadStatus } from '@/components/leads/types'

export type DedupeDecisionStatus = 'pending' | 'merged' | 'not_duplicate'

/** Ảnh chụp lead để review — field hiển thị + số nguồn + status + 2 cột điểm (join lead_scores). */
export type DedupeLeadSnapshot = {
  id: string
  fullName: string | null
  email: string | null
  companyName: string | null
  title: string | null
  industry: string | null
  companySize: number | null
  phone: string | null
  phoneValid: boolean | null
  status: LeadStatus
  createdAt: string
  sourceCount: number
  ruleScore: number | null
  aiScore: number | null
}

export type DedupePair = {
  id: string
  nameSimilarity: number | null
  companySimilarity: number | null
  createdAt: string
  a: DedupeLeadSnapshot
  b: DedupeLeadSnapshot
}

export type DedupePairsResponse = {
  pairs: DedupePair[]
  total: number
}

// POST /api/dedupe/pairs/:id/decision — discriminated union theo contract.
export type DedupeDecisionBody =
  | { decision: 'merged'; keptLeadId: string }
  | { decision: 'not_duplicate' }
