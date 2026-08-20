import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { leadScores, leads } from '@/db/schema'

// Query parsing + điều kiện lọc dùng chung cho GET /api/leads và GET /api/leads/export.
// Đặt cùng thư mục route (luồng B sở hữu) để export bám ĐÚNG filter của list.
// Contract: docs/sot/40-api-contracts.md §Leads.

// Cột được phép sort. ruleScore/aiScore nằm trong contract nhưng dữ liệu ở lead_scores —
// luồng E (Batch 2) join vào và wire sort thật; Batch 1 nhận param hợp lệ nhưng fallback createdAt.
const SORTABLE = ['createdAt', 'fullName', 'companyName', 'companySize', 'status', 'ruleScore', 'aiScore'] as const
const STATUS = ['new', 'contacted', 'qualified', 'won', 'lost'] as const

export const leadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  sort: z.enum(SORTABLE).catch('createdAt').default('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc').default('desc'),
  status: z.enum(STATUS).optional(),
  industry: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
})

export type LeadsQuery = z.infer<typeof leadsQuerySchema>

// Alias `lead_scores` hai lần: một cho bản rule, một cho bản ai — để join cả hai vào
// GET /api/leads và /export (mỗi lead ≤ 1 bản mỗi kind, unique (lead_id, kind)).
// Định nghĩa ở đây để route + export + buildLeadsOrderBy dùng CHUNG một alias.
export const ruleScores = alias(leadScores, 'rule_scores')
export const aiScores = alias(leadScores, 'ai_scores')

export function parseLeadsQuery(searchParams: URLSearchParams): LeadsQuery {
  // Bỏ các key rỗng để .optional()/.default() hoạt động đúng (?status= → undefined)
  const raw: Record<string, string> = {}
  for (const [k, v] of searchParams.entries()) {
    if (v !== '') raw[k] = v
  }
  return leadsQuerySchema.parse(raw)
}

// Escape ký tự wildcard của LIKE để user gõ '%' không match toàn bộ.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** WHERE dùng chung. LUÔN lọc archived_at IS NULL (chỉ lead active — instruction + SoT). */
export function buildLeadsWhere(q: LeadsQuery): SQL {
  const conditions: SQL[] = [isNull(leads.archivedAt)]

  if (q.status) conditions.push(eq(leads.status, q.status))
  if (q.industry) conditions.push(eq(leads.industry, q.industry))

  if (q.search) {
    const pattern = `%${escapeLike(q.search)}%`
    const match = or(
      ilike(leads.fullName, pattern),
      ilike(leads.email, pattern),
      ilike(leads.companyName, pattern),
    )
    if (match) conditions.push(match)
  }

  return and(...conditions) as SQL
}

const SORT_COLUMN = {
  createdAt: leads.createdAt,
  fullName: leads.fullNameNormalized,
  companyName: leads.companyNameNormalized,
  companySize: leads.companySize,
  status: leads.status,
} as const
type ScalarSort = keyof typeof SORT_COLUMN

/**
 * ORDER BY. Thêm id làm tie-break để phân trang ổn định (deterministic).
 * ruleScore/aiScore: sort theo cột đã join (lead_scores.score) với NULLS LAST — lead
 * chưa chấm (score NULL) luôn xuống cuối dù asc hay desc, để lead đã chấm nổi lên đầu.
 */
export function buildLeadsOrderBy(q: LeadsQuery): SQL[] {
  if (q.sort === 'ruleScore' || q.sort === 'aiScore') {
    const col = q.sort === 'ruleScore' ? ruleScores.score : aiScores.score
    const ordered = q.order === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`
    return [ordered, asc(leads.id)]
  }
  const col = SORT_COLUMN[q.sort as ScalarSort]
  const dir = q.order === 'asc' ? asc : desc
  return [dir(col), asc(leads.id)]
}
