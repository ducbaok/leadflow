import type { AiScoreInput } from './ai-input'

// Orchestrator chấm AI — THUẦN về I/O: mọi thứ đi qua cổng (scorer + store) được inject.
// Nhờ vậy AC-7 (cache) và AC-8 (retry→failed, không crash job) test được bằng mock, không cần DB.
// SoT: docs/sot/30-scoring-spec.md §2 (luồng, cache, retry).

/** Cổng gọi LLM. Production = createAnthropicScorer; test = mock có counter. */
export type AiScorer = (input: AiScoreInput) => Promise<{ score: number; reason: string }>

/** Cổng ghi lead_scores(kind='ai'). Production = Drizzle; test = in-memory. */
export interface AiScoreStore {
  markPending(leadId: string, inputHash: string, model: string): Promise<void>
  saveCompleted(leadId: string, inputHash: string, model: string, score: number, reason: string): Promise<void>
  saveFailed(leadId: string, inputHash: string, model: string, error: string): Promise<void>
}

/** Bản ghi ai score hiện có, để quyết định cache hit. */
export interface ExistingScore {
  inputHash: string | null
  status: 'pending' | 'completed' | 'failed'
}

export interface AiScoreSummary {
  scored: number
  cached: number
  failed: number
}

/**
 * Cache (AC-7): lead có score ai completed + input_hash trùng → BỎ QUA, 0 gọi LLM.
 * Chỉ 'completed' mới được cache; 'pending'/'failed' luôn chấm lại.
 */
function isCacheHit(prev: ExistingScore | undefined, inputHash: string): boolean {
  return prev != null && prev.status === 'completed' && prev.inputHash === inputHash
}

/**
 * Chấm AI cho danh sách input đã dựng sẵn (hash đã tính).
 * - Cache hit → tăng `cached`, không gọi scorer, không ghi gì.
 * - Miss → markPending → gọi scorer → saveCompleted.
 * - Lỗi 1 lead (AC-8) → saveFailed + tiếp tục lead khác, KHÔNG throw (không fail cả job).
 *   Retry transient nằm ở tầng SDK (maxRetries) + pg-boss; ở đây chỉ đánh dấu failed khi đã hết retry.
 */
export async function runAiScoring(params: {
  inputs: AiScoreInput[]
  existing: Map<string, ExistingScore>
  scorer: AiScorer
  store: AiScoreStore
}): Promise<AiScoreSummary> {
  const { inputs, existing, scorer, store } = params
  const summary: AiScoreSummary = { scored: 0, cached: 0, failed: 0 }

  for (const input of inputs) {
    if (isCacheHit(existing.get(input.leadId), input.inputHash)) {
      summary.cached++
      continue
    }
    await store.markPending(input.leadId, input.inputHash, input.model)
    try {
      const { score, reason } = await scorer(input)
      await store.saveCompleted(input.leadId, input.inputHash, input.model, score, reason)
      summary.scored++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await store.saveFailed(input.leadId, input.inputHash, input.model, message)
      summary.failed++
    }
  }
  return summary
}
