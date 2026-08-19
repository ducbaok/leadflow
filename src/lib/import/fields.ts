// Các trường đích của một lead mà cột CSV có thể map vào.
// SoT: docs/sot/40-api-contracts.md §Imports — LeadField ∈
//   fullName | email | companyName | title | industry | companySize | phone
// File thuần dữ liệu (không import server-only) → dùng được cả client lẫn server.

export const LEAD_FIELDS = [
  'fullName',
  'email',
  'companyName',
  'title',
  'industry',
  'companySize',
  'phone',
] as const

export type LeadField = (typeof LEAD_FIELDS)[number]

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  fullName: 'Full name',
  email: 'Email',
  companyName: 'Company',
  title: 'Job title',
  industry: 'Industry',
  companySize: 'Company size',
  phone: 'Phone',
}

const LEAD_FIELD_SET = new Set<string>(LEAD_FIELDS)

export function isLeadField(value: unknown): value is LeadField {
  return typeof value === 'string' && LEAD_FIELD_SET.has(value)
}

/** mapping = { csvHeader → LeadField | null }. `null`/absent = cột bị bỏ qua. */
export type ColumnMapping = Record<string, LeadField | null>
