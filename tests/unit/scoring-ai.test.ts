import { describe, expect, it, vi } from 'vitest'
import { parseAiToolResponse } from '@/lib/scoring/ai-client'
import { buildAiInput, type AiLead } from '@/lib/scoring/ai-input'
import { runAiScoring, type AiScoreStore, type ExistingScore } from '@/lib/scoring/ai-runner'
import { SCORE_TOOL_NAME } from '@/lib/scoring/constants'

// SoT: docs/sot/30-scoring-spec.md §2. AC-7 (cache) + AC-8 (retry→failed) — chứng minh bằng counter.

const MODEL = 'claude-haiku-4-5'
const ICP = 'Bán phần mềm tài chính cho DN sản xuất 20-500 nhân sự.'

function lead(overrides: Partial<AiLead> = {}): AiLead {
  return {
    id: 'lead-1',
    fullName: 'Nguyễn Văn An',
    title: 'CFO',
    companyName: 'FPT Software',
    industry: 'manufacturing',
    companySize: 200,
    email: 'an@fpt.com.vn',
    phoneValid: true,
    ...overrides,
  }
}

type StoreCall = { leadId: string; inputHash: string; model: string; score?: number; reason?: string; error?: string }
function memStore() {
  const calls = { pending: [] as StoreCall[], completed: [] as StoreCall[], failed: [] as StoreCall[] }
  const store: AiScoreStore = {
    async markPending(leadId, inputHash, model) {
      calls.pending.push({ leadId, inputHash, model })
    },
    async saveCompleted(leadId, inputHash, model, score, reason) {
      calls.completed.push({ leadId, inputHash, model, score, reason })
    },
    async saveFailed(leadId, inputHash, model, error) {
      calls.failed.push({ leadId, inputHash, model, error })
    },
  }
  return { store, calls }
}

describe('input_hash (buildAiInput)', () => {
  it('deterministic — cùng input → cùng hash', () => {
    const a = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const b = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    expect(a.inputHash).toBe(b.inputHash)
  })

  it('đổi 1 field TRONG hash-set (title) → hash đổi', () => {
    const a = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const b = buildAiInput(lead({ title: 'CEO' }), { model: MODEL, icpDescription: ICP })
    expect(a.inputHash).not.toBe(b.inputHash)
  })

  it('đổi field NGOÀI hash-set (email khác nhưng cùng loại domain) → hash KHÔNG đổi', () => {
    const a = buildAiInput(lead({ email: 'an@fpt.com.vn' }), { model: MODEL, icpDescription: ICP })
    const b = buildAiInput(lead({ email: 'khac@vng.com.vn' }), { model: MODEL, icpDescription: ICP })
    // cả hai đều company domain → emailDomainType không đổi → hash bằng nhau
    expect(a.inputHash).toBe(b.inputHash)
  })

  it('đổi model hoặc ICP → hash đổi (chấm lại)', () => {
    const base = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    expect(buildAiInput(lead(), { model: 'claude-sonnet-5', icpDescription: ICP }).inputHash).not.toBe(base.inputHash)
    expect(buildAiInput(lead(), { model: MODEL, icpDescription: ICP + ' v2' }).inputHash).not.toBe(base.inputHash)
  })
})

describe('runAiScoring — AC-7 cache theo input_hash', () => {
  it('lead KHÔNG đổi (hash trùng + completed) → 0 gọi API', async () => {
    const input = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const scorer = vi.fn(async () => ({ score: 80, reason: 'phù hợp' }))
    const { store, calls } = memStore()
    const existing = new Map<string, ExistingScore>([[input.leadId, { inputHash: input.inputHash, status: 'completed' }]])

    const summary = await runAiScoring({ inputs: [input], existing, scorer, store })

    expect(scorer).toHaveBeenCalledTimes(0)
    expect(summary).toEqual({ scored: 0, cached: 1, failed: 0 })
    expect(calls.pending).toHaveLength(0)
    expect(calls.completed).toHaveLength(0)
  })

  it('đổi 1 field trong hash-set → gọi lại ĐÚNG 1 lần', async () => {
    const oldInput = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const newInput = buildAiInput(lead({ title: 'CEO' }), { model: MODEL, icpDescription: ICP })
    const scorer = vi.fn(async () => ({ score: 60, reason: 'đã đổi' }))
    const { store, calls } = memStore()
    const existing = new Map<string, ExistingScore>([[oldInput.leadId, { inputHash: oldInput.inputHash, status: 'completed' }]])

    const summary = await runAiScoring({ inputs: [newInput], existing, scorer, store })

    expect(scorer).toHaveBeenCalledTimes(1)
    expect(summary).toEqual({ scored: 1, cached: 0, failed: 0 })
    expect(calls.completed).toHaveLength(1)
    expect(calls.completed[0].inputHash).toBe(newInput.inputHash)
  })

  it('lead chưa từng chấm → gọi 1 lần', async () => {
    const input = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const scorer = vi.fn(async () => ({ score: 70, reason: 'mới' }))
    const { store } = memStore()
    await runAiScoring({ inputs: [input], existing: new Map(), scorer, store })
    expect(scorer).toHaveBeenCalledTimes(1)
  })

  it('score failed trước đó (dù hash trùng) → chấm lại, KHÔNG cache failed', async () => {
    const input = buildAiInput(lead(), { model: MODEL, icpDescription: ICP })
    const scorer = vi.fn(async () => ({ score: 75, reason: 'retry ok' }))
    const { store } = memStore()
    const existing = new Map<string, ExistingScore>([[input.leadId, { inputHash: input.inputHash, status: 'failed' }]])
    await runAiScoring({ inputs: [input], existing, scorer, store })
    expect(scorer).toHaveBeenCalledTimes(1)
  })
})

describe('runAiScoring — AC-8 lỗi API', () => {
  it('lỗi 1 lead → đánh dấu failed, KHÔNG throw, vẫn xử lý lead còn lại', async () => {
    const bad = buildAiInput(lead({ id: 'bad' }), { model: MODEL, icpDescription: ICP })
    const good = buildAiInput(lead({ id: 'good' }), { model: MODEL, icpDescription: ICP })
    const scorer = vi.fn(async (input: { leadId: string }) => {
      if (input.leadId === 'bad') throw new Error('529 overloaded')
      return { score: 88, reason: 'ổn' }
    })
    const { store, calls } = memStore()

    const summary = await runAiScoring({ inputs: [bad, good], existing: new Map(), scorer, store })

    expect(summary).toEqual({ scored: 1, cached: 0, failed: 1 })
    expect(calls.failed).toHaveLength(1)
    expect(calls.failed[0].leadId).toBe('bad')
    expect(calls.failed[0].error).toContain('529')
    expect(calls.completed).toHaveLength(1)
    expect(calls.completed[0].leadId).toBe('good')
    // pending được set cho cả hai trước khi gọi API
    expect(calls.pending.map((p) => p.leadId).sort()).toEqual(['bad', 'good'])
  })
})

describe('parseAiToolResponse (strict tool output)', () => {
  const msg = (content: unknown[]) => ({ content } as never)

  it('đọc score + reason, clamp score ≤100 và cắt reason ≤240 ký tự', () => {
    const long = 'x'.repeat(300)
    const out = parseAiToolResponse(
      msg([
        { type: 'text', text: 'bỏ qua' },
        { type: 'tool_use', name: SCORE_TOOL_NAME, id: 't1', input: { score: 130, reason: '  ' + long + '  ' } },
      ]),
    )
    expect(out.score).toBe(100)
    expect(out.reason.length).toBe(240)
  })

  it('score âm → 0; số thực → làm tròn', () => {
    expect(
      parseAiToolResponse(msg([{ type: 'tool_use', name: SCORE_TOOL_NAME, id: 't', input: { score: -5, reason: 'a' } }]))
        .score,
    ).toBe(0)
    expect(
      parseAiToolResponse(msg([{ type: 'tool_use', name: SCORE_TOOL_NAME, id: 't', input: { score: 79.6, reason: 'a' } }]))
        .score,
    ).toBe(80)
  })

  it('không có tool_use → throw', () => {
    expect(() => parseAiToolResponse(msg([{ type: 'text', text: 'no tool' }]))).toThrow()
  })
})
