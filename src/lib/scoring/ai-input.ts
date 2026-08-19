import { createHash } from 'node:crypto'
import { emailDomainType, type EmailDomainType } from './domain'
import { PROMPT_VERSION } from './constants'

// Xây input AI + input_hash. SoT: docs/sot/30-scoring-spec.md §Input hash.
// Thuần (không I/O) → unit-test được trực tiếp.

/** Lead tối thiểu để chấm AI (subset bảng leads). */
export interface AiLead {
  id: string
  fullName?: string | null
  title?: string | null
  companyName?: string | null
  industry?: string | null
  companySize?: number | null
  email?: string | null
  emailNormalized?: string | null
  phoneValid?: boolean | null
}

/** 7 field vào hash (đúng thứ tự spec) — cũng chính là thông tin lead gửi cho LLM. */
export interface AiHashFields {
  fullName: string | null
  title: string | null
  companyName: string | null
  industry: string | null
  companySize: number | null
  emailDomainType: EmailDomainType
  phoneValid: boolean | null
}

export interface AiScoreInput {
  leadId: string
  fields: AiHashFields
  inputHash: string
  model: string
  icpDescription: string
}

/**
 * input_hash = sha256( JSON(7 field theo đúng thứ tự) + PROMPT_VERSION + model + icpDescription ).
 * Thứ tự key CỐ ĐỊNH ở đây → hash ổn định bất kể thứ tự field truyền vào (30-scoring-spec §Input hash).
 */
export function computeInputHash(fields: AiHashFields, model: string, icpDescription: string | null): string {
  const canonical = JSON.stringify({
    fullName: fields.fullName,
    title: fields.title,
    companyName: fields.companyName,
    industry: fields.industry,
    companySize: fields.companySize,
    emailDomainType: fields.emailDomainType,
    phoneValid: fields.phoneValid,
  })
  return createHash('sha256')
    .update(canonical + PROMPT_VERSION + model + (icpDescription ?? ''))
    .digest('hex')
}

export function buildAiInput(lead: AiLead, opts: { model: string; icpDescription: string | null }): AiScoreInput {
  const fields: AiHashFields = {
    fullName: lead.fullName ?? null,
    title: lead.title ?? null,
    companyName: lead.companyName ?? null,
    industry: lead.industry ?? null,
    companySize: lead.companySize ?? null,
    emailDomainType: emailDomainType(lead.emailNormalized ?? lead.email),
    phoneValid: lead.phoneValid ?? null,
  }
  return {
    leadId: lead.id,
    fields,
    inputHash: computeInputHash(fields, opts.model, opts.icpDescription),
    model: opts.model,
    icpDescription: opts.icpDescription ?? '',
  }
}
