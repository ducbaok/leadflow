import Anthropic from '@anthropic-ai/sdk'
import { SCORE_TOOL_NAME } from './constants'
import { aiOutputSchema } from './schema'
import type { AiScoreInput } from './ai-input'
import type { AiScorer } from './ai-runner'

// Cầu nối tới @anthropic-ai/sdk: structured output bằng STRICT TOOL USE (ép đúng {score, reason}).
// SoT: docs/sot/30-scoring-spec.md §2 (Contract với LLM).
//
// Client được INJECT qua tham số (createAnthropicScorer) → test bằng mock, không cần ANTHROPIC_API_KEY.

// strict:true → SDK ép validate tên tool + input theo schema (additionalProperties:false + required).
const SCORE_TOOL: Anthropic.Tool = {
  name: SCORE_TOOL_NAME,
  description:
    'Nộp điểm mức độ phù hợp (ICP fit) của lead: score nguyên 0-100 và reason ngắn gọn bằng tiếng Việt (≤ 240 ký tự).',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'reason'],
    properties: {
      score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Điểm phù hợp ICP, 0 = không phù hợp, 100 = phù hợp hoàn hảo.',
      },
      reason: {
        type: 'string',
        maxLength: 240,
        description: 'Lý do ngắn gọn bằng TIẾNG VIỆT, tối đa 240 ký tự, nêu tín hiệu chính (chức danh, quy mô, ngành).',
      },
    },
  },
}

/** Prompt gửi LLM. Đổi nội dung ở đây → BUMP PROMPT_VERSION (constants.ts) để input_hash đổi. */
export function buildScoringMessages(input: AiScoreInput): { system: string; user: string } {
  const icp = input.icpDescription.trim() || '(chưa mô tả ICP — hãy chấm dựa trên thông tin lead một cách hợp lý)'
  const system = [
    'Bạn là trợ lý chấm điểm lead B2B. Nhiệm vụ: đánh giá mức độ phù hợp giữa lead và hồ sơ khách hàng lý tưởng (ICP) bên dưới.',
    'Chấm 0-100 (0 = không phù hợp, 100 = phù hợp hoàn hảo) dựa trên: chức danh (người quyết định?), quy mô công ty, ngành, và loại domain email.',
    'Trả lời DUY NHẤT bằng cách gọi tool submit_lead_score. reason viết bằng tiếng Việt, ngắn gọn, nêu tín hiệu chính.',
    '',
    'ICP:',
    icp,
  ].join('\n')

  const f = input.fields
  const user = [
    'Thông tin lead:',
    `- Họ tên: ${f.fullName ?? '(trống)'}`,
    `- Chức danh: ${f.title ?? '(trống)'}`,
    `- Công ty: ${f.companyName ?? '(trống)'}`,
    `- Ngành: ${f.industry ?? '(trống)'}`,
    `- Quy mô (số nhân sự): ${f.companySize ?? '(trống)'}`,
    `- Loại email domain: ${f.emailDomainType}`,
    `- Số điện thoại hợp lệ: ${f.phoneValid == null ? '(không có)' : f.phoneValid ? 'có' : 'không'}`,
  ].join('\n')

  return { system, user }
}

/**
 * Đọc tool_use block, validate, clamp: score → int 0-100, reason → trim + ≤240 ký tự.
 * strict:true đã đảm bảo shape, nhưng vẫn parse phòng thủ (không tin văn xuôi).
 */
export function parseAiToolResponse(message: Anthropic.Message): { score: number; reason: string } {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SCORE_TOOL_NAME,
  )
  if (!block) throw new Error('AI không trả về tool_use submit_lead_score')
  const parsed = aiOutputSchema.parse(block.input)
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)))
  const reason = parsed.reason.trim().slice(0, 240)
  return { score, reason }
}

/** Tạo scorer đóng gói client + model. Client inject được → mock trong test. */
export function createAnthropicScorer(client: Anthropic, model: string): AiScorer {
  return async (input) => {
    const { system, user } = buildScoringMessages(input)
    const message = await client.messages.create({
      model,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [SCORE_TOOL],
      tool_choice: { type: 'tool', name: SCORE_TOOL_NAME },
    })
    return parseAiToolResponse(message)
  }
}

/**
 * Client thật với maxRetries=3 (exponential backoff của SDK — 30-scoring-spec §2.4).
 * Trả null nếu chưa có ANTHROPIC_API_KEY → worker bỏ qua job an toàn (chưa cấu hình key).
 */
export function createAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null
  return new Anthropic({ maxRetries: 3 })
}
