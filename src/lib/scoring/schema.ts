import { z } from 'zod'

// Zod schema cho rule JSON + body PUT config.
// SoT ngữ nghĩa: docs/sot/30-scoring-spec.md §1 (schema rule). API: 40-api-contracts.md §Scoring.
// Đây KHÔNG phải SoT — chỉ là validation phái sinh từ 30-scoring-spec.

/** Field của leads được phép tham chiếu trong rule (whitelist → an toàn khi build SQL). */
export const scoreFieldSchema = z.enum([
  'fullName',
  'email',
  'companyName',
  'title',
  'industry',
  'companySize',
  'phone',
  'phoneValid',
])
export type ScoreField = z.infer<typeof scoreFieldSchema>

const points = z.number().int()

// op quyết định các tham số còn lại (discriminated union theo 'op').
export const ruleItemSchema = z.discriminatedUnion('op', [
  // so trên chuỗi fold dấu + lowercase, khớp nếu chứa BẤT KỲ value nào
  z.object({ field: scoreFieldSchema, op: z.literal('contains_any'), values: z.array(z.string()).min(1), points }),
  // set-membership sau khi fold + lowercase
  z.object({ field: scoreFieldSchema, op: z.literal('in'), values: z.array(z.string()).min(1), points }),
  // khoảng đóng 2 đầu (số)
  z.object({ field: scoreFieldSchema, op: z.literal('between'), min: z.number(), max: z.number(), points }),
  // so bằng (boolean / number / string)
  z.object({ field: scoreFieldSchema, op: z.literal('equals'), value: z.union([z.boolean(), z.number(), z.string()]), points }),
  // domain ∉ free-mail list
  z.object({ field: scoreFieldSchema, op: z.literal('is_company_domain'), points }),
])
export type RuleItem = z.infer<typeof ruleItemSchema>

export const rulesConfigSchema = z.object({
  version: z.number().int(),
  rules: z.array(ruleItemSchema),
})
export type RulesConfig = z.infer<typeof rulesConfigSchema>

/** Body PUT /api/scoring/config — mọi field optional (partial update singleton). */
export const scoringConfigUpdateSchema = z
  .object({
    icpDescription: z.string().max(4000).nullable().optional(),
    rules: rulesConfigSchema.optional(),
    aiTopN: z.number().int().positive().max(1000).optional(),
  })
  .refine((v) => v.icpDescription !== undefined || v.rules !== undefined || v.aiTopN !== undefined, {
    message: 'Cần ít nhất một trong: icpDescription, rules, aiTopN',
  })
export type ScoringConfigUpdate = z.infer<typeof scoringConfigUpdateSchema>

/** Output AI (strict tool). reason có thể dài hơn 240 — clamp lúc parse, không reject. */
export const aiOutputSchema = z.object({
  score: z.number(),
  reason: z.string(),
})
