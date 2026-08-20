import { createHash } from 'node:crypto'

// Fuzzy dedupe — hằng số & bản tham chiếu thuần (không I/O). SoT: docs/sot/20-dedupe-spec.md §Tầng 2.
// SQL set-based trong scan.ts MIRROR đúng các ngưỡng này (giống evaluateRules ↔ rules-sql của luồng C).

/**
 * 4 ngưỡng 2-tier. Đã probe khớp golden set (tests/fixtures/golden-pairs.json) 100% →
 * **KHOÁ LẠI**: không tune thêm nếu chưa sửa golden set + file spec (brief §7.1, chống tinh chỉnh vô hạn).
 * - Tier 1 bắt biến thể tên/hậu tố công ty (golden #4–7, #12–14).
 * - Tier 2 giữ cửa cho "tên trùng tuyệt đối + công ty mẹ/con" mà không mở cho "tên trùng + công ty khác hẳn"
 *   (golden #9 Viettel/VNPT bị loại vì company 0.08 < 0.20).
 */
export const DEDUPE_THRESHOLDS = {
  T1_NAME: 0.55,
  T1_COMPANY: 0.3,
  T2_NAME: 0.9,
  T2_COMPANY: 0.2,
} as const

/**
 * Ngưỡng prune cho toán tử `%` (GIN gin_trgm_ops) = ngưỡng name NHỎ NHẤT giữa 2 tier.
 * Mọi candidate đều có name_sim ≥ 0.55 (tier 2 cần ≥ 0.90 ⊃ 0.55) nên prune ở 0.55 KHÔNG mất cặp nào —
 * đã kiểm chứng: prune vs full self-join cho cùng số cặp, nhanh hơn ~17×.
 */
export const NAME_PRUNE_THRESHOLD: number = DEDUPE_THRESHOLDS.T1_NAME

/**
 * Cặp (nameSim, companySim) rơi vào tier nào (null = không phải candidate). Bản tham chiếu để
 * unit test khoá ngưỡng; SQL trong scan.ts dùng CÙNG hằng số DEDUPE_THRESHOLDS.
 */
export function candidateTier(nameSim: number, companySim: number): 1 | 2 | null {
  const { T1_NAME, T1_COMPANY, T2_NAME, T2_COMPANY } = DEDUPE_THRESHOLDS
  if (nameSim >= T1_NAME && companySim >= T1_COMPANY) return 1
  if (nameSim >= T2_NAME && companySim >= T2_COMPANY) return 2
  return null
}

export function isCandidatePair(nameSim: number, companySim: number): boolean {
  return candidateTier(nameSim, companySim) !== null
}

/**
 * pair_hash = sha256(min(idA,idB) || ':' || max(idA,idB)) — SoT 20-dedupe-spec.md. UNIQUE để
 * re-scan `ON CONFLICT DO NOTHING` → cặp đã quyết không bao giờ bị re-flag (AC-12).
 *
 * Production sinh hash bằng SQL `encode(sha256(convert_to(a.id||':'||b.id,'UTF8')),'hex')` với
 * a.id < b.id (uuid `<` ⟺ so sánh text canonical lowercase). Hàm JS này là bản tham chiếu cho test.
 */
export function computePairHash(idA: string, idB: string): string {
  const [min, max] = idA < idB ? [idA, idB] : [idB, idA]
  return createHash('sha256').update(`${min}:${max}`).digest('hex')
}
