import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

// ============================================================
// SoT cấu trúc DB. Ngữ nghĩa & lý do thiết kế: docs/sot/10-data-model.md
// Thay đổi file này = thay đổi Source of Truth → xem quy tắc trong CLAUDE.md
// ============================================================

export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'qualified', 'won', 'lost'])
export const importBatchStatusEnum = pgEnum('import_batch_status', ['pending', 'processing', 'completed', 'failed'])
export const dedupeDecisionEnum = pgEnum('dedupe_decision', ['pending', 'merged', 'not_duplicate'])
export const scoreKindEnum = pgEnum('score_kind', ['rule', 'ai'])
export const scoreStatusEnum = pgEnum('score_status', ['pending', 'completed', 'failed'])

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename'),
  sourceType: text('source_type').notNull().default('csv'), // 'csv' | 'apollo_mock' | 'seed'
  status: importBatchStatusEnum('status').notNull().default('pending'),
  mapping: jsonb('mapping'),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  errorRows: integer('error_rows').notNull().default(0),
  insertedLeads: integer('inserted_leads').notNull().default(0),
  updatedLeads: integer('updated_leads').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    // NULL cho phép (lead thiếu email vẫn import — ADR-002); partial unique index bên dưới
    emailNormalized: text('email_normalized'),
    fullName: text('full_name'),
    fullNameNormalized: text('full_name_normalized'),
    // token của full_name_normalized sort alphabet — đầu vào fuzzy (bắt đảo tên, xem 20-dedupe-spec.md)
    fullNameSorted: text('full_name_sorted'),
    companyName: text('company_name'),
    companyNameNormalized: text('company_name_normalized'),
    title: text('title'),
    industry: text('industry'),
    companySize: integer('company_size'),
    phone: text('phone'),
    phoneValid: boolean('phone_valid'),
    status: leadStatusEnum('status').notNull().default('new'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => leads.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Bao gồm cả lead đã archive: import lại email của bản bị archive phải
    // conflict vào bản cũ rồi redirect qua merged_into_id (không hồi sinh dupe)
    uniqueIndex('leads_email_normalized_unique')
      .on(t.emailNormalized)
      .where(sql`email_normalized IS NOT NULL`),
    index('leads_status_idx').on(t.status),
    index('leads_created_at_idx').on(t.createdAt),
    // GIN trigram index cho fuzzy nằm ở migration custom (cần CREATE EXTENSION pg_trgm trước)
  ],
)

export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id),
    sourceType: text('source_type').notNull(),
    rowNumber: integer('row_number'),
    rawData: jsonb('raw_data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_sources_lead_id_idx').on(t.leadId), index('lead_sources_batch_id_idx').on(t.importBatchId)],
)

// Staging table: bulk insert thô, validate từng dòng, rồi promote sang leads bằng SQL set-based
export const importRows = pgTable(
  'import_rows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').notNull(),
    email: text('email'),
    emailNormalized: text('email_normalized'),
    fullName: text('full_name'),
    fullNameNormalized: text('full_name_normalized'),
    fullNameSorted: text('full_name_sorted'),
    companyName: text('company_name'),
    companyNameNormalized: text('company_name_normalized'),
    title: text('title'),
    industry: text('industry'),
    companySize: integer('company_size'),
    phone: text('phone'),
    phoneValid: boolean('phone_valid'),
    validationError: text('validation_error'),
    leadId: uuid('lead_id'), // set sau khi promote
  },
  (t) => [index('import_rows_batch_id_idx').on(t.batchId)],
)

export const mappingTemplates = pgTable('mapping_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  mapping: jsonb('mapping').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dedupePairs = pgTable(
  'dedupe_pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // sha256(sorted(leadAId, leadBId)) — idempotency: re-import không re-flag cặp đã quyết
    pairHash: text('pair_hash').notNull(),
    leadAId: uuid('lead_a_id')
      .notNull()
      .references(() => leads.id),
    leadBId: uuid('lead_b_id')
      .notNull()
      .references(() => leads.id),
    nameSimilarity: real('name_similarity'),
    companySimilarity: real('company_similarity'),
    decision: dedupeDecisionEnum('decision').notNull().default('pending'),
    keptLeadId: uuid('kept_lead_id').references(() => leads.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dedupe_pairs_pair_hash_unique').on(t.pairHash), index('dedupe_pairs_decision_idx').on(t.decision)],
)

// Singleton (id luôn = 1). JSON schema của rules: docs/sot/30-scoring-spec.md
export const scoringConfig = pgTable('scoring_config', {
  id: integer('id').primaryKey().default(1),
  icpDescription: text('icp_description'),
  rules: jsonb('rules').notNull(),
  aiTopN: integer('ai_top_n').notNull().default(200),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const leadScores = pgTable(
  'lead_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: scoreKindEnum('kind').notNull(),
    score: integer('score'),
    reason: text('reason'),
    // hash các field đầu vào của lead — lead không đổi thì không gọi lại AI
    inputHash: text('input_hash'),
    model: text('model'),
    status: scoreStatusEnum('status').notNull().default('completed'),
    error: text('error'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lead_scores_lead_kind_unique').on(t.leadId, t.kind)],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)],
)
