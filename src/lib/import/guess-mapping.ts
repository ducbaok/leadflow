import { foldDiacritics } from '@/lib/normalize/text'
import { LEAD_FIELDS, type ColumnMapping, type LeadField } from './fields'

// Đoán cột: header CSV → LeadField. Chạy phía server (POST /api/imports) để prefill
// mapping UI; người dùng luôn sửa lại được. SoT contract: guessedMapping trong 40-api-contracts.md.

// Quy tắc HEADER-CENTRIC theo độ đặc hiệu: xét từng header, khớp mẫu cụ thể TRƯỚC mẫu chung.
// Thứ tự quan trọng — vd "company_size" phải trúng size (dòng 2) trước company (dòng 6);
// "company" trúng companyName (dòng 6) chứ không phải fullName.
const RULES: { field: LeadField; test: RegExp }[] = [
  { field: 'email', test: /\be-?mail\b|email|thu dien tu/ },
  { field: 'companySize', test: /size|employe|headcount|quy mo|nhan su|so nhan vien|so luong nv/ },
  { field: 'phone', test: /phone|mobile|\btel\b|dien thoai|\bsdt\b|\bs(o|dt)\b|so dien thoai|lien he/ },
  { field: 'title', test: /title|position|chuc (vu|danh)|\brole\b|job/ },
  { field: 'industry', test: /industry|nganh|sector|linh vuc|field/ },
  { field: 'companyName', test: /company|cong ty|\bcty\b|to chuc|organi|employer|doanh nghiep|firm/ },
  { field: 'fullName', test: /name|ho ten|ho va ten|\bten\b|full|contact|nguoi/ },
]

function matchField(header: string): LeadField | null {
  const h = foldDiacritics(header).toLowerCase().trim()
  for (const rule of RULES) {
    if (rule.test.test(h)) return rule.field
  }
  return null
}

/**
 * Trả về { header → LeadField | null } cho toàn bộ header.
 * Mỗi LeadField chỉ nhận từ MỘT header (header xuất hiện trước thắng) — khớp
 * với chính sách "first wins" của invertMapping ở promote.
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const claimed = new Set<LeadField>()
  for (const header of headers) {
    const field = matchField(header)
    if (field && !claimed.has(field)) {
      mapping[header] = field
      claimed.add(field)
    } else {
      mapping[header] = null
    }
  }
  return mapping
}

export { LEAD_FIELDS }
