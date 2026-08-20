import { describe, expect, it } from 'vitest'
import { candidateTier, isCandidatePair, DEDUPE_THRESHOLDS } from '@/lib/dedupe/constants'

// candidateTier là bản THAM CHIẾU của điều kiện candidate; SQL set-based trong scan.ts mirror đúng
// hằng số này (giống evaluateRules ↔ rules-sql của luồng C). Test khoá ngưỡng theo golden set.
// Spec: docs/sot/20-dedupe-spec.md §Tầng 2.

describe('candidateTier — biên ngưỡng', () => {
  const { T1_NAME, T1_COMPANY, T2_NAME, T2_COMPANY } = DEDUPE_THRESHOLDS

  it('Tier 1: name ≥ 0.55 AND company ≥ 0.30', () => {
    expect(candidateTier(T1_NAME, T1_COMPANY)).toBe(1) // đúng biên → khớp (>=)
    expect(candidateTier(T1_NAME - 0.01, T1_COMPANY)).toBeNull() // name dưới biên
    expect(candidateTier(T1_NAME, T1_COMPANY - 0.01)).toBeNull() // company dưới biên
  })

  it('Tier 2: name ≥ 0.90 AND company ≥ 0.20 (bắt công ty mẹ/con khi tên trùng tuyệt đối)', () => {
    // company 0.25 < T1_COMPANY (0.30) nên KHÔNG phải tier 1, nhưng name cao → tier 2.
    expect(candidateTier(T2_NAME, 0.25)).toBe(2)
    expect(candidateTier(T2_NAME, T2_COMPANY)).toBe(2)
    expect(candidateTier(T2_NAME, T2_COMPANY - 0.01)).toBeNull()
    expect(candidateTier(T2_NAME - 0.01, T2_COMPANY)).toBeNull() // rơi khỏi tier 2, company quá thấp cho tier 1
  })

  it('company match ĐƠN LẺ (tên khác hẳn) không đủ để flag', () => {
    expect(isCandidatePair(0.18, 1.0)).toBe(false) // golden #8
  })

  it('name match ĐƠN LẺ (công ty khác hẳn) không đủ để flag', () => {
    expect(isCandidatePair(1.0, 0.08)).toBe(false) // golden #9 Viettel/VNPT
  })
})

// Similarity THỰC ĐO bằng pg_trgm (PostgreSQL 16) trên chuỗi golden đã normalize
// (full_name_sorted, company_name_normalized). Khoá lại: nếu ai đổi ngưỡng, test này vỡ ngay.
const GOLDEN_FUZZY: Array<{ id: number; name: number; company: number; flag: boolean; note: string }> = [
  { id: 4, name: 1.0, company: 1.0, flag: true, note: 'dấu TV + hậu tố pháp lý' },
  { id: 5, name: 1.0, company: 1.0, flag: true, note: 'Corporation/Corp strip' },
  { id: 6, name: 1.0, company: 1.0, flag: true, note: 'JSC suffix' },
  { id: 7, name: 0.63, company: 0.36, flag: true, note: 'viết tắt chữ lót' },
  { id: 8, name: 0.18, company: 1.0, flag: false, note: 'cùng công ty, tên khác' },
  { id: 9, name: 1.0, company: 0.08, flag: false, note: 'tên phổ biến, công ty khác' },
  { id: 10, name: 1.0, company: 1.0, flag: true, note: 'ranh giới gmail rule' },
  { id: 11, name: 1.0, company: 0.13, flag: false, note: 'công ty na ná, sim thấp' },
  { id: 12, name: 1.0, company: 0.31, flag: true, note: 'FPT vs FPT Software' },
  { id: 13, name: 0.64, company: 0.47, flag: true, note: 'đảo thứ tự tên' },
  { id: 14, name: 1.0, company: 0.33, flag: true, note: 'Grab vs Grab Financial Group' },
  { id: 15, name: 0.71, company: 0.07, flag: false, note: 'viết tắt TCB — chấp nhận bỏ sót' },
]

describe('golden set — ngưỡng khớp 100% cặp fuzzy', () => {
  for (const g of GOLDEN_FUZZY) {
    it(`#${g.id} (${g.note}) → ${g.flag ? 'flag' : 'không flag'}`, () => {
      expect(isCandidatePair(g.name, g.company)).toBe(g.flag)
    })
  }
})
