import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '@/lib/scoring/constants'
import { emailDomainType, isCompanyDomain } from '@/lib/scoring/domain'
import { evaluateRules } from '@/lib/scoring/rules'
import { rulesConfigSchema, type RulesConfig } from '@/lib/scoring/schema'

// Ngữ nghĩa rule: docs/sot/30-scoring-spec.md §1. evaluateRules là bản tham chiếu mà SQL set-based mirror.

describe('evaluateRules — config mặc định', () => {
  const cfg = DEFAULT_RULES

  it('CFO tiếng Việt (fold dấu) + quy mô + ngành + phone + company domain = 90', () => {
    const score = evaluateRules(cfg, {
      title: 'Kế toán trưởng', // contains_any 'ke toan truong' (fold dấu) → +30
      companySize: 200, // between 20-500 → +25
      industry: 'manufacturing', // in → +15
      phoneValid: true, // equals true → +10
      emailNormalized: 'an@fpt.com.vn', // company domain → +10
    })
    expect(score).toBe(90)
  })

  it('field NULL → rule đó không khớp, không trừ điểm', () => {
    expect(
      evaluateRules(cfg, { title: null, companySize: null, industry: null, phoneValid: null, emailNormalized: null }),
    ).toBe(0)
  })

  it('free-mail không được tính là company domain', () => {
    expect(evaluateRules(cfg, { emailNormalized: 'a@gmail.com' })).toBe(0)
    expect(evaluateRules(cfg, { emailNormalized: 'a@yahoo.com' })).toBe(0)
  })

  it('contains_any khớp một trong nhiều value', () => {
    expect(evaluateRules(cfg, { title: 'Group CFO & Head of Finance' })).toBe(30)
  })
})

describe('evaluateRules — ops', () => {
  it('between đóng cả 2 đầu', () => {
    const c: RulesConfig = { version: 1, rules: [{ field: 'companySize', op: 'between', min: 20, max: 500, points: 25 }] }
    expect(evaluateRules(c, { companySize: 20 })).toBe(25)
    expect(evaluateRules(c, { companySize: 500 })).toBe(25)
    expect(evaluateRules(c, { companySize: 19 })).toBe(0)
    expect(evaluateRules(c, { companySize: 501 })).toBe(0)
  })

  it('in khớp chính xác sau fold + lowercase', () => {
    const c: RulesConfig = { version: 1, rules: [{ field: 'industry', op: 'in', values: ['manufacturing'], points: 15 }] }
    expect(evaluateRules(c, { industry: 'Manufacturing' })).toBe(15)
    expect(evaluateRules(c, { industry: 'software' })).toBe(0)
  })

  it('equals boolean cho phoneValid', () => {
    const c: RulesConfig = { version: 1, rules: [{ field: 'phoneValid', op: 'equals', value: true, points: 10 }] }
    expect(evaluateRules(c, { phoneValid: true })).toBe(10)
    expect(evaluateRules(c, { phoneValid: false })).toBe(0)
    expect(evaluateRules(c, { phoneValid: null })).toBe(0)
  })

  it('score = min(100, Σ) — cap ở 100', () => {
    const heavy: RulesConfig = {
      version: 1,
      rules: [
        { field: 'title', op: 'contains_any', values: ['cfo'], points: 60 },
        { field: 'companySize', op: 'between', min: 1, max: 10000, points: 60 },
      ],
    }
    expect(evaluateRules(heavy, { title: 'CFO', companySize: 100 })).toBe(100)
  })
})

describe('emailDomainType / isCompanyDomain', () => {
  it('company / free / none', () => {
    expect(emailDomainType('an@fpt.com.vn')).toBe('company')
    expect(emailDomainType('a@gmail.com')).toBe('free')
    expect(emailDomainType(null)).toBe('none')
    expect(emailDomainType('not-an-email')).toBe('none')
  })
  it('isCompanyDomain chỉ true khi có email hợp lệ + không free-mail', () => {
    expect(isCompanyDomain('an@fpt.com.vn')).toBe(true)
    expect(isCompanyDomain('a@yahoo.com')).toBe(false)
    expect(isCompanyDomain(null)).toBe(false)
  })
})

describe('rulesConfigSchema', () => {
  it('parse config mặc định OK', () => {
    expect(() => rulesConfigSchema.parse(DEFAULT_RULES)).not.toThrow()
  })
  it('reject op không hợp lệ', () => {
    expect(rulesConfigSchema.safeParse({ version: 1, rules: [{ field: 'title', op: 'regex', points: 10 }] }).success).toBe(
      false,
    )
  })
  it('reject field ngoài whitelist', () => {
    expect(
      rulesConfigSchema.safeParse({ version: 1, rules: [{ field: 'salary', op: 'between', min: 1, max: 2, points: 10 }] })
        .success,
    ).toBe(false)
  })
})
