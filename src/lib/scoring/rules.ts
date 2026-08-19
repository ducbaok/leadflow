import { foldDiacritics } from '@/lib/normalize/text'
import { isCompanyDomain } from './domain'
import type { RuleItem, RulesConfig, ScoreField } from './schema'

// Đánh giá rule dạng THUẦN (in-memory) — SoT: docs/sot/30-scoring-spec.md §1.
//
// Đây là ngữ nghĩa CHUẨN của rule scoring và là bản tham chiếu cho phần chạy set-based
// trong SQL (rules-sql.ts). Production dùng SQL để chạy set-based toàn bộ lead active;
// hàm này giữ đúng semantics và được test trực tiếp (tests/unit/scoring-rules.test.ts).
// Hai bên PHẢI khớp — đổi một bên thì đổi bên kia.

/** Lead tối thiểu cần cho scoring (subset của bảng leads). */
export interface ScorableLead {
  fullName?: string | null
  email?: string | null
  emailNormalized?: string | null
  companyName?: string | null
  title?: string | null
  industry?: string | null
  companySize?: number | null
  phone?: string | null
  phoneValid?: boolean | null
}

/** Fold dấu + lowercase để so khớp chuỗi (30-scoring-spec §1: contains_any/in). */
export function foldForMatch(s: string | null | undefined): string {
  if (!s) return ''
  return foldDiacritics(s).toLowerCase()
}

function textField(lead: ScorableLead, field: ScoreField): string | null {
  switch (field) {
    case 'fullName':
      return lead.fullName ?? null
    case 'companyName':
      return lead.companyName ?? null
    case 'title':
      return lead.title ?? null
    case 'industry':
      return lead.industry ?? null
    case 'phone':
      return lead.phone ?? null
    case 'email':
      return lead.emailNormalized ?? lead.email ?? null
    default:
      return null
  }
}

function ruleMatches(rule: RuleItem, lead: ScorableLead): boolean {
  switch (rule.op) {
    case 'contains_any': {
      const hay = foldForMatch(textField(lead, rule.field))
      if (!hay) return false
      return rule.values.some((v) => {
        const needle = foldForMatch(v)
        return needle !== '' && hay.includes(needle)
      })
    }
    case 'in': {
      const raw = textField(lead, rule.field)
      if (raw == null) return false
      const norm = foldForMatch(raw)
      return rule.values.some((v) => foldForMatch(v) === norm)
    }
    case 'between': {
      const n = lead.companySize
      if (n == null) return false
      return n >= rule.min && n <= rule.max
    }
    case 'equals': {
      if (rule.field === 'phoneValid') {
        if (lead.phoneValid == null) return false
        return typeof rule.value === 'boolean' && lead.phoneValid === rule.value
      }
      if (rule.field === 'companySize') {
        if (lead.companySize == null) return false
        return Number(rule.value) === lead.companySize
      }
      const raw = textField(lead, rule.field)
      if (raw == null) return false
      return foldForMatch(raw) === foldForMatch(String(rule.value))
    }
    case 'is_company_domain':
      return isCompanyDomain(lead.emailNormalized ?? lead.email)
  }
}

/**
 * score = min(100, Σ points các rule khớp). Field NULL → rule đó không khớp (không trừ điểm).
 * Điểm RULE tách biệt hoàn toàn với điểm AI — không bao giờ cộng gộp (brief §6).
 */
export function evaluateRules(config: RulesConfig, lead: ScorableLead): number {
  let sum = 0
  for (const rule of config.rules) {
    if (ruleMatches(rule, lead)) sum += rule.points
  }
  return Math.min(100, sum)
}
