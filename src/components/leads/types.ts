// Shape phía client, mirror GET /api/leads (docs/sot/40-api-contracts.md §Leads).

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost'

export type LeadRow = {
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
  ruleScore: number | null
  aiScore: number | null
  aiReason: string | null
  // Trạng thái bản chấm AI (additive, ADR-008): 'pending' = đang chấm (badge "Scoring…"),
  // null = chưa từng chấm AI. Phân biệt hai ca này với 'completed'/'failed'.
  aiStatus: 'pending' | 'completed' | 'failed' | null
}

export type LeadsResponse = {
  rows: LeadRow[]
  total: number
  page: number
  pageSize: number
}

export type LeadSource = {
  id: string
  sourceType: string
  rowNumber: number | null
  rawData: Record<string, unknown>
  createdAt: string
  batchFilename: string | null
}

export type LeadScore = {
  kind: 'rule' | 'ai'
  score: number | null
  reason: string | null
  model: string | null
  scoredAt: string | null
  status: 'pending' | 'completed' | 'failed'
}

export type LeadDetailResponse = {
  lead: LeadRow
  sources: LeadSource[]
  scores: LeadScore[]
}

// Phễu New → Contacted → Qualified → Won/Lost (thứ tự hiển thị + màu badge).
export const STATUS_FLOW: { value: LeadStatus; label: string; badge: string }[] = [
  { value: 'new', label: 'New', badge: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  { value: 'contacted', label: 'Contacted', badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  { value: 'qualified', label: 'Qualified', badge: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  { value: 'won', label: 'Won', badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  { value: 'lost', label: 'Lost', badge: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
]

export const STATUS_META: Record<LeadStatus, { label: string; badge: string }> = Object.fromEntries(
  STATUS_FLOW.map((s) => [s.value, { label: s.label, badge: s.badge }]),
) as Record<LeadStatus, { label: string; badge: string }>

// Ngành dùng cho filter dropdown — tập giá trị domain ổn định (khớp scripts/seed.ts).
export const INDUSTRIES: { value: string; label: string }[] = [
  { value: 'software', label: 'Software' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'retail', label: 'Retail' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'education', label: 'Education' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'media', label: 'Media' },
]
