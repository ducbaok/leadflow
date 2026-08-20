// Hằng số của F3 Scoring. SoT ngữ nghĩa: docs/sot/30-scoring-spec.md
// Đổi PROMPT_VERSION khi đổi prompt AI → mọi input_hash đổi → chấm lại toàn bộ.

import type { RulesConfig } from './schema'

/** Bump khi đổi nội dung prompt AI. Vào công thức input_hash (30-scoring-spec §Input hash). */
export const PROMPT_VERSION = 'v1'

/** Model mặc định khi env AI_SCORING_MODEL trống. */
export const DEFAULT_AI_MODEL = 'claude-haiku-4-5'

/** Chunk size cho job score.ai (40-api-contracts: "chunk ≤ 25 lead/job"). */
export const AI_CHUNK_SIZE = 25

/** Top-N mặc định cho AI khi scoring_config chưa có (schema default cũng = 200). */
export const DEFAULT_AI_TOP_N = 200

/**
 * Danh sách free-mail (30-scoring-spec §1 op is_company_domain + §Input hash emailDomainType).
 * Domain ∉ set này → coi là company domain.
 */
export const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'])

/** Tên tool strict dùng ép structured output {score, reason}. */
export const SCORE_TOOL_NAME = 'submit_lead_score'

/** Model AI thực tế: env override được, không hardcode (brief §6 + .env.example). */
export function resolveAiModel(): string {
  return process.env.AI_SCORING_MODEL?.trim() || DEFAULT_AI_MODEL
}

/**
 * Rule mặc định — dùng khi scoring_config chưa được seed (GET config trả về đây).
 * Bản seed thật nằm ở src/lib/demo/seed.ts; cả hai đều phái sinh từ 30-scoring-spec §1.
 */
export const DEFAULT_RULES: RulesConfig = {
  version: 1,
  rules: [
    { field: 'title', op: 'contains_any', values: ['cfo', 'chief financial', 'finance director', 'ke toan truong', 'head of finance'], points: 30 },
    { field: 'companySize', op: 'between', min: 20, max: 500, points: 25 },
    { field: 'industry', op: 'in', values: ['manufacturing', 'retail', 'ecommerce'], points: 15 },
    { field: 'phoneValid', op: 'equals', value: true, points: 10 },
    { field: 'email', op: 'is_company_domain', points: 10 },
  ],
}

// ---------------------------------------------------------------------------
// Rào chi phí AI trên demo public (ADR-010, 40-api-contracts §Rào chi phí AI).
// CẢ HAI mặc định TẮT khi env trống → local/CI giữ nguyên hành vi Batch 1.
// ---------------------------------------------------------------------------

/** Đọc env số nguyên dương; trống/rác/≤0 → null (coi như không đặt rào). */
function positiveIntEnv(raw: string | undefined): number | null {
  const n = Number(raw?.trim())
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null
}

/** Trần số lead mỗi lần chấm AI. null = không clamp. */
export function resolveAiMaxLeadsPerRun(): number | null {
  return positiveIntEnv(process.env.AI_MAX_LEADS_PER_RUN)
}

/** Khoảng cách tối thiểu giữa 2 lần chạy AI, tính bằng giây. 0 = không cooldown. */
export function resolveAiCooldownSeconds(): number {
  return positiveIntEnv(process.env.AI_RUN_COOLDOWN_SECONDS) ?? 0
}

/** Áp trần lên top-N. Hàm thuần để test được không cần env/DB. */
export function applyAiCap(topN: number, max: number | null): { effective: number; capped: boolean } {
  if (max === null || topN <= max) return { effective: topN, capped: false }
  return { effective: max, capped: true }
}

/**
 * Số giây còn phải chờ trước khi được chạy AI lần nữa. 0 = cho chạy.
 * `lastRunAt` null (chưa từng chạy) hoặc cooldown = 0 → luôn 0.
 */
export function cooldownRemainingSeconds(lastRunAt: Date | null, cooldownSeconds: number, now: Date): number {
  if (!lastRunAt || cooldownSeconds <= 0) return 0
  const elapsed = (now.getTime() - lastRunAt.getTime()) / 1000
  return elapsed >= cooldownSeconds ? 0 : Math.ceil(cooldownSeconds - elapsed)
}
