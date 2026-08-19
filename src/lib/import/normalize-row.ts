import { normalizeEmail } from '@/lib/normalize/email'
import { validatePhone } from '@/lib/normalize/phone'
import { normalizeCompany, normalizePersonName, sortNameTokens } from '@/lib/normalize/text'
import type { ColumnMapping, LeadField } from './fields'

// Áp mapping + normalize (dùng LẠI src/lib/normalize/, không viết lại logic) + validate
// từng dòng staging. Kết quả có key snake_case KHỚP cột import_rows để ghi thẳng lại bằng
// jsonb_to_recordset (xem promote.ts). SoT normalize: docs/sot/10-data-model.md.

/** Giá trị đã normalize của một dòng staging — key snake_case = tên cột import_rows. */
export type StagedRowValues = {
  email: string | null
  email_normalized: string | null
  full_name: string | null
  full_name_normalized: string | null
  full_name_sorted: string | null
  company_name: string | null
  company_name_normalized: string | null
  title: string | null
  industry: string | null
  company_size: number | null
  phone: string | null
  phone_valid: boolean | null
  validation_error: string | null
}

/** Đảo mapping thành { LeadField → header }. Nếu nhiều header cùng map một field, header đầu thắng. */
export function invertMapping(mapping: ColumnMapping): Partial<Record<LeadField, string>> {
  const inv: Partial<Record<LeadField, string>> = {}
  for (const [header, field] of Object.entries(mapping)) {
    if (field && !(field in inv)) inv[field] = header
  }
  return inv
}

function parseCompanySize(raw: string): number | null {
  const m = raw.match(/\d[\d.,]*/)
  if (!m) return null
  const n = Number.parseInt(m[0].replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/**
 * Chuẩn hoá một dòng raw theo mapping đã đảo (inv). Không đọc DB — thuần hàm.
 *
 * Chính sách validate (luồng A sở hữu — KHÔNG phải contract SoT; ghi rõ lý do ở đây):
 *  - Email TRỐNG (thiếu) → không lỗi, import thành lead-không-email (ADR-002 / AC-4).
 *  - Email CÓ nhưng sai định dạng → dòng LỖI (báo "row N: email không hợp lệ"), không promote.
 *    Lý do: user chủ ý nhập email để định danh; email hỏng là lỗi dữ liệu cần user thấy,
 *    không nên âm thầm rơi vào rổ no-email (nơi không dedupe exact được).
 *  - Không có bất kỳ định danh nào (email + tên + công ty đều trống) → dòng LỖI (dòng rỗng).
 *  - Phone sai → phone_valid=false (không phải lỗi dòng). company_size không phải số → null.
 */
export function normalizeMappedRow(
  raw: Record<string, unknown>,
  inv: Partial<Record<LeadField, string>>,
): StagedRowValues {
  const get = (field: LeadField): string => {
    const header = inv[field]
    if (!header) return ''
    const v = raw[header]
    return v == null ? '' : String(v).trim()
  }

  const emailRaw = get('email')
  const email_normalized = normalizeEmail(emailRaw)
  const full_name = get('fullName') || null
  const full_name_normalized = normalizePersonName(full_name)
  const full_name_sorted = full_name_normalized ? sortNameTokens(full_name_normalized) : null
  const company_name = get('companyName') || null
  const company_name_normalized = normalizeCompany(company_name)
  const title = get('title') || null
  const industry = get('industry') || null
  const company_size = parseCompanySize(get('companySize'))
  const phone = get('phone') || null
  const phone_valid = validatePhone(phone)

  let validation_error: string | null = null
  if (emailRaw && email_normalized === null) {
    validation_error = `Email không hợp lệ: "${truncate(emailRaw)}"`
  } else if (!email_normalized && !full_name && !company_name) {
    validation_error = 'Dòng thiếu thông tin định danh (email, tên và công ty đều trống)'
  }

  return {
    email: emailRaw || null,
    email_normalized,
    full_name,
    full_name_normalized,
    full_name_sorted,
    company_name,
    company_name_normalized,
    title,
    industry,
    company_size,
    phone,
    phone_valid,
    validation_error,
  }
}
