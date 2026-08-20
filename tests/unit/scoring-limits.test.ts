import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyAiCap,
  cooldownRemainingSeconds,
  resolveAiCooldownSeconds,
  resolveAiMaxLeadsPerRun,
} from '@/lib/scoring/constants'

// Rào chi phí AI trên demo public — ADR-010, 40-api-contracts §Rào chi phí AI.
// Điểm cốt lõi cần khoá lại bằng test: env TRỐNG = TẮT rào (local/CI giữ nguyên hành vi Batch 1).

afterEach(() => vi.unstubAllEnvs())

describe('resolveAiMaxLeadsPerRun', () => {
  it('trống → null (không clamp)', () => {
    vi.stubEnv('AI_MAX_LEADS_PER_RUN', '')
    expect(resolveAiMaxLeadsPerRun()).toBeNull()
  })

  it.each(['0', '-5', 'abc', '2.5'])('giá trị không hợp lệ %s → null', (raw) => {
    vi.stubEnv('AI_MAX_LEADS_PER_RUN', raw)
    expect(resolveAiMaxLeadsPerRun()).toBeNull()
  })

  it('số nguyên dương → đúng số đó', () => {
    vi.stubEnv('AI_MAX_LEADS_PER_RUN', ' 25 ')
    expect(resolveAiMaxLeadsPerRun()).toBe(25)
  })
})

describe('resolveAiCooldownSeconds', () => {
  it('trống → 0 (không cooldown)', () => {
    vi.stubEnv('AI_RUN_COOLDOWN_SECONDS', '')
    expect(resolveAiCooldownSeconds()).toBe(0)
  })

  it('số hợp lệ → đúng số đó', () => {
    vi.stubEnv('AI_RUN_COOLDOWN_SECONDS', '60')
    expect(resolveAiCooldownSeconds()).toBe(60)
  })
})

describe('applyAiCap', () => {
  it('không có trần → giữ nguyên top-N', () => {
    expect(applyAiCap(200, null)).toEqual({ effective: 200, capped: false })
  })

  it('top-N nhỏ hơn trần → không cắt', () => {
    expect(applyAiCap(10, 25)).toEqual({ effective: 10, capped: false })
  })

  it('bằng trần → không đánh dấu capped', () => {
    expect(applyAiCap(25, 25)).toEqual({ effective: 25, capped: false })
  })

  it('vượt trần → cắt xuống và đánh dấu capped', () => {
    expect(applyAiCap(200, 25)).toEqual({ effective: 25, capped: true })
  })
})

describe('cooldownRemainingSeconds', () => {
  const now = new Date('2026-08-20T10:00:00Z')

  it('chưa từng chạy → cho chạy ngay', () => {
    expect(cooldownRemainingSeconds(null, 60, now)).toBe(0)
  })

  it('cooldown = 0 → luôn cho chạy', () => {
    expect(cooldownRemainingSeconds(new Date('2026-08-20T09:59:59Z'), 0, now)).toBe(0)
  })

  it('đã qua đủ thời gian → cho chạy', () => {
    expect(cooldownRemainingSeconds(new Date('2026-08-20T09:58:00Z'), 60, now)).toBe(0)
  })

  it('còn trong cooldown → trả số giây phải chờ (làm tròn lên)', () => {
    // chạy lúc 09:59:30.500, cooldown 60s → đã trôi 29,5s, còn 30,5s → làm tròn lên 31
    expect(cooldownRemainingSeconds(new Date('2026-08-20T09:59:30.500Z'), 60, now)).toBe(31)
  })

  it('vừa chạy xong → chờ trọn cooldown', () => {
    expect(cooldownRemainingSeconds(now, 60, now)).toBe(60)
  })
})
