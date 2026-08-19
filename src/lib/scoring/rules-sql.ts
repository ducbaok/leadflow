import { sql, type SQL } from 'drizzle-orm'
import { FREE_MAIL_DOMAINS } from './constants'
import { foldForMatch } from './rules'
import type { RuleItem, RulesConfig, ScoreField } from './schema'

// Build biểu thức SQL chấm điểm rule CHẠY SET-BASED cho toàn bộ lead active trong 1 câu.
// SoT: docs/sot/30-scoring-spec.md §1 ("Chạy set-based cho toàn bộ lead active").
// Semantics phải khớp evaluateRules() trong rules.ts (bản tham chiếu được unit-test).
//
// Mọi giá trị từ config đi qua bound param (${...}) → không SQL injection.
// Chỉ tên cột (whitelist qua ScoreField) mới dùng sql.raw.

// Tên cột leads theo field (alias bảng = "l" trong INSERT ... SELECT của job).
function colName(field: ScoreField): string {
  switch (field) {
    case 'fullName':
      return 'l.full_name'
    case 'email':
      return 'l.email_normalized'
    case 'companyName':
      return 'l.company_name'
    case 'title':
      return 'l.title'
    case 'industry':
      return 'l.industry'
    case 'companySize':
      return 'l.company_size'
    case 'phone':
      return 'l.phone'
    case 'phoneValid':
      return 'l.phone_valid'
  }
}

/**
 * Fold dấu + lowercase một cột NGAY TRONG Postgres — không cần extension unaccent.
 * normalize(x, NFD) tách dấu tổ hợp → regexp_replace bỏ dải U+0300–U+036F → translate đ→d.
 * Khớp foldDiacritics() (src/lib/normalize/text.ts) + lowercase.
 */
function foldCol(col: string): SQL {
  return sql`translate(regexp_replace(normalize(lower(coalesce(${sql.raw(col)}, '')), NFD), '[̀-ͯ]', '', 'g'), 'đ', 'd')`
}

// Escape ký tự đặc biệt của LIKE (\ % _) — giá trị vẫn đi qua bound param.
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1')
}

/** Điều kiện boolean SQL cho một rule (khớp = TRUE). */
function ruleCondition(rule: RuleItem): SQL {
  switch (rule.op) {
    case 'contains_any': {
      const col = foldCol(colName(rule.field))
      const likes = rule.values
        .map((v) => foldForMatch(v))
        .filter((v) => v !== '')
        .map((v) => sql`${col} LIKE ${'%' + escapeLike(v) + '%'}`)
      return likes.length ? sql`(${sql.join(likes, sql` OR `)})` : sql`false`
    }
    case 'in': {
      const col = foldCol(colName(rule.field))
      const vals = rule.values.map((v) => foldForMatch(v))
      return vals.length ? sql`${col} IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})` : sql`false`
    }
    case 'between': {
      const col = sql.raw(colName(rule.field))
      return sql`${col} BETWEEN ${rule.min} AND ${rule.max}`
    }
    case 'equals': {
      if (typeof rule.value === 'boolean' || typeof rule.value === 'number') {
        const col = sql.raw(colName(rule.field))
        return sql`${col} = ${rule.value}`
      }
      const col = foldCol(colName(rule.field))
      return sql`${col} = ${foldForMatch(rule.value)}`
    }
    case 'is_company_domain': {
      const free = [...FREE_MAIL_DOMAINS]
      return sql`l.email_normalized IS NOT NULL AND split_part(l.email_normalized, '@', 2) NOT IN (${sql.join(
        free.map((d) => sql`${d}`),
        sql`, `,
      )})`
    }
  }
}

/**
 * Biểu thức số nguyên: LEAST(100, Σ CASE WHEN <cond> THEN points ELSE 0 END).
 * Dùng trong `SELECT ... FROM leads l` của job score.rules.
 */
export function buildRuleScoreExpr(config: RulesConfig): SQL {
  const terms = config.rules.map((rule) => sql`(CASE WHEN ${ruleCondition(rule)} THEN ${rule.points} ELSE 0 END)`)
  if (terms.length === 0) return sql`0`
  return sql`LEAST(100, ${sql.join(terms, sql` + `)})`
}
