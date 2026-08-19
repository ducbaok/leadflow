// CSV serialization + injection defense.
// SoT: docs/sot/40-api-contracts.md §Leads `GET /api/leads/export` —
// "mọi ô bắt đầu bằng `=` `+` `-` `@` được prefix `'`" (chống CSV/formula injection khi mở bằng Excel).

// Ký tự mở đầu công thức mà spreadsheet (Excel/Sheets/LibreOffice) sẽ thực thi.
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@'])

/**
 * Escape một ô CSV:
 *  1. Nếu ô bắt đầu bằng `= + - @` → prefix `'` để spreadsheet coi là text (SoT).
 *  2. RFC 4180 quoting: nếu chứa `,` `"` CR hoặc LF → bọc `"..."` và nhân đôi `"`.
 * Thứ tự quan trọng: neutralize formula TRƯỚC, rồi mới quote — để dấu `'` nằm trong ô.
 */
export function escapeCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)

  if (s.length > 0 && FORMULA_PREFIXES.has(s[0]!)) {
    s = `'${s}`
  }

  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`
  }

  return s
}

/** Ghép một mảng giá trị thành 1 dòng CSV (đã escape từng ô). */
export function formatCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCsvCell).join(',')
}

// Shape 1 dòng lead xuất CSV — mirror GET /api/leads (kể cả score fields để cột ổn định;
// Batch 1 luồng B để null, Batch 2 luồng E điền số vào cùng cột).
export type LeadCsvRow = {
  id: string
  fullName: string | null
  email: string | null
  companyName: string | null
  title: string | null
  industry: string | null
  companySize: number | null
  phone: string | null
  phoneValid: boolean | null
  status: string
  createdAt: string | Date
  ruleScore: number | null
  aiScore: number | null
  aiReason: string | null
}

type Column = { key: keyof LeadCsvRow; header: string }

export const LEAD_CSV_COLUMNS: readonly Column[] = [
  { key: 'id', header: 'ID' },
  { key: 'fullName', header: 'Full name' },
  { key: 'email', header: 'Email' },
  { key: 'companyName', header: 'Company' },
  { key: 'title', header: 'Title' },
  { key: 'industry', header: 'Industry' },
  { key: 'companySize', header: 'Company size' },
  { key: 'phone', header: 'Phone' },
  { key: 'phoneValid', header: 'Phone valid' },
  { key: 'status', header: 'Status' },
  { key: 'createdAt', header: 'Created at' },
  { key: 'ruleScore', header: 'Rule score' },
  { key: 'aiScore', header: 'AI score' },
  { key: 'aiReason', header: 'AI reason' },
]

function cellValue(row: LeadCsvRow, key: keyof LeadCsvRow): unknown {
  const v = row[key]
  if (key === 'createdAt') return v instanceof Date ? v.toISOString() : v
  if (key === 'phoneValid') return v === null || v === undefined ? '' : v ? 'true' : 'false'
  return v
}

export function leadCsvHeaderLine(): string {
  return formatCsvRow(LEAD_CSV_COLUMNS.map((c) => c.header))
}

export function leadCsvRowLine(row: LeadCsvRow): string {
  return formatCsvRow(LEAD_CSV_COLUMNS.map((c) => cellValue(row, c.key)))
}

/** Toàn bộ CSV (header + rows) — dùng cho test và export nhỏ. Route export stream từng dòng. */
export function buildLeadsCsv(rows: readonly LeadCsvRow[]): string {
  return [leadCsvHeaderLine(), ...rows.map(leadCsvRowLine)].join('\r\n') + '\r\n'
}
