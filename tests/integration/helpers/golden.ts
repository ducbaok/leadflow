import { invertMapping, normalizeMappedRow, type StagedRowValues } from '@/lib/import/normalize-row'
import { normalizeCompany, normalizePersonName, sortNameTokens } from '@/lib/normalize/text'
import type { ColumnMapping } from '@/lib/import/fields'
import goldenJson from '../../fixtures/golden-pairs.json'

// Đọc SoT golden set (chỉ đọc — tests/fixtures/golden-pairs.json là file SoT) và cung cấp
// helper build dữ liệu đã normalize BẰNG code thật của src/lib/normalize. Không copy logic normalize.

export type GoldenExpected = 'duplicate' | 'suspect' | 'not_duplicate'
export type GoldenSide = { fullName?: string; companyName?: string; email?: string }
export type GoldenPair = {
  id: number
  kind: 'exact' | 'fuzzy'
  expected: GoldenExpected
  a: GoldenSide
  b: GoldenSide
  note: string
}

export const GOLDEN_PAIRS: GoldenPair[] = (goldenJson as { pairs: GoldenPair[] }).pairs
export const EXACT_PAIRS = GOLDEN_PAIRS.filter((p) => p.kind === 'exact')
export const FUZZY_PAIRS = GOLDEN_PAIRS.filter((p) => p.kind === 'fuzzy')

// Một golden fuzzy pair PHẢI bị flag (xuất hiện trong dedupe_pairs) khi expected != not_duplicate.
export function shouldFlag(pair: GoldenPair): boolean {
  return pair.expected !== 'not_duplicate'
}

// Mapping canonical dùng cho staging (header → LeadField), rồi đảo thành field → header.
const INV = invertMapping({
  full_name: 'fullName',
  email: 'email',
  company: 'companyName',
} as ColumnMapping)

/** raw jsonb như một dòng CSV thô cho một golden side. */
export function rawRow(side: GoldenSide): Record<string, string> {
  return {
    full_name: side.fullName ?? '',
    email: side.email ?? '',
    company: side.companyName ?? '',
  }
}

/** StagedRowValues (snake_case) đã normalize bằng code thật — cho một golden side. */
export function stagedValues(side: GoldenSide): StagedRowValues {
  return normalizeMappedRow(rawRow(side), INV)
}

/** Đổi StagedRowValues (snake_case) → shape insert drizzle importRows (camelCase). */
export function toImportRowCols(v: StagedRowValues) {
  return {
    email: v.email,
    emailNormalized: v.email_normalized,
    fullName: v.full_name,
    fullNameNormalized: v.full_name_normalized,
    fullNameSorted: v.full_name_sorted,
    companyName: v.company_name,
    companyNameNormalized: v.company_name_normalized,
    title: v.title,
    industry: v.industry,
    companySize: v.company_size,
    phone: v.phone,
    phoneValid: v.phone_valid,
    validationError: v.validation_error,
  }
}

/** Cột đã normalize cho bảng `leads` (input của fuzzy scan) — một golden side. */
export function leadCols(side: GoldenSide) {
  const fullName = side.fullName ?? null
  const companyName = side.companyName ?? null
  const fullNameNormalized = fullName ? normalizePersonName(fullName) : null
  return {
    fullName,
    fullNameNormalized,
    fullNameSorted: fullNameNormalized ? sortNameTokens(fullNameNormalized) : null,
    companyName,
    companyNameNormalized: companyName ? normalizeCompany(companyName) : null,
  }
}
