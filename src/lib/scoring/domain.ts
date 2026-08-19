import { normalizeEmail } from '@/lib/normalize/email'
import { FREE_MAIL_DOMAINS } from './constants'

// Phân loại domain email — dùng cho cả rule (is_company_domain) lẫn AI (emailDomainType trong input_hash).
// SoT: docs/sot/30-scoring-spec.md §1 + §Input hash.

export type EmailDomainType = 'company' | 'free' | 'none'

/** Nhận email đã normalize HOẶC email thô (sẽ tự normalize). Trả domain lowercase hoặc null. */
export function emailDomain(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const at = normalized.lastIndexOf('@')
  return at === -1 ? null : normalized.slice(at + 1)
}

/** 'none' nếu không có email hợp lệ; 'free' nếu domain ∈ free-mail; ngược lại 'company'. */
export function emailDomainType(email: string | null | undefined): EmailDomainType {
  const domain = emailDomain(email)
  if (!domain) return 'none'
  return FREE_MAIL_DOMAINS.has(domain) ? 'free' : 'company'
}

/** true chỉ khi có email hợp lệ VÀ domain không thuộc free-mail. */
export function isCompanyDomain(email: string | null | undefined): boolean {
  return emailDomainType(email) === 'company'
}
