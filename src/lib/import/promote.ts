import { sql, type SQL } from 'drizzle-orm'
import type { Db } from '@/db/client'

// Promote staging → leads bằng SQL SET-BASED (không row-by-row qua ORM — brief §3.1).
// Mọi bước idempotent: job chết giữa chừng, chạy lại từ đầu vô hại (ADR-003).
// Chính sách upsert: SoT docs/sot/10-data-model.md §"Chính sách upsert khi promote".

async function execRows<T>(db: Db, query: SQL): Promise<T[]> {
  const res = await db.execute(query)
  return res as unknown as T[]
}

export type PromoteCounts = { inserted: number; updated: number }

/**
 * @param sourceType để gắn vào lead_sources.source_type (vd 'csv').
 * @returns số lead mới tạo (inserted) và số lead đã có bị đụng conflict (updated).
 */
export async function promoteBatch(db: Db, batchId: string, sourceType: string): Promise<PromoteCounts> {
  // ── (1) Lead CÓ email → upsert theo email_normalized ────────────────────────────
  // DISTINCT ON: cùng email nhiều dòng trong file → lấy dòng CUỐI (row_number lớn nhất);
  // các dòng còn lại vẫn được ghi lead_sources ở bước (5).
  // ON CONFLICT (partial unique index) → điền chỗ trống, KHÔNG ghi đè (COALESCE) → import
  // cũ không phá dữ liệu user đã sửa. (xmax = 0) phân biệt insert mới vs update.
  const upsertRows = await execRows<{ inserted: number; updated: number }>(
    db,
    sql`
      WITH upsert AS (
        INSERT INTO leads (
          email, email_normalized, full_name, full_name_normalized, full_name_sorted,
          company_name, company_name_normalized, title, industry, company_size, phone, phone_valid
        )
        SELECT DISTINCT ON (email_normalized)
          email, email_normalized, full_name, full_name_normalized, full_name_sorted,
          company_name, company_name_normalized, title, industry, company_size, phone, phone_valid
        FROM import_rows
        WHERE batch_id = ${batchId} AND validation_error IS NULL AND email_normalized IS NOT NULL
        ORDER BY email_normalized, row_number DESC
        ON CONFLICT (email_normalized) WHERE email_normalized IS NOT NULL
        DO UPDATE SET
          email = COALESCE(leads.email, EXCLUDED.email),
          full_name = COALESCE(leads.full_name, EXCLUDED.full_name),
          full_name_normalized = COALESCE(leads.full_name_normalized, EXCLUDED.full_name_normalized),
          full_name_sorted = COALESCE(leads.full_name_sorted, EXCLUDED.full_name_sorted),
          company_name = COALESCE(leads.company_name, EXCLUDED.company_name),
          company_name_normalized = COALESCE(leads.company_name_normalized, EXCLUDED.company_name_normalized),
          title = COALESCE(leads.title, EXCLUDED.title),
          industry = COALESCE(leads.industry, EXCLUDED.industry),
          company_size = COALESCE(leads.company_size, EXCLUDED.company_size),
          phone = COALESCE(leads.phone, EXCLUDED.phone),
          phone_valid = COALESCE(leads.phone_valid, EXCLUDED.phone_valid),
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
      )
      SELECT
        count(*) FILTER (WHERE inserted)::int AS inserted,
        count(*) FILTER (WHERE NOT inserted)::int AS updated
      FROM upsert
    `,
  )
  const emailInserted = upsertRows[0]?.inserted ?? 0
  const emailUpdated = upsertRows[0]?.updated ?? 0

  // ── (2) Gắn lead_id cho MỌI dòng có email (kể cả dòng bị DISTINCT ON bỏ) ─────────
  // Nguồn gắn vào COALESCE(merged_into_id, id): nếu lead đích đã bị archive/merge thì
  // redirect qua bản active, không hồi sinh dupe (SoT 10-data-model §leads).
  await db.execute(sql`
    UPDATE import_rows ir
    SET lead_id = COALESCE(l.merged_into_id, l.id)
    FROM leads l
    WHERE ir.batch_id = ${batchId}
      AND ir.validation_error IS NULL
      AND ir.email_normalized IS NOT NULL
      AND l.email_normalized = ir.email_normalized
  `)

  // ── (3) Lead KHÔNG email → cấp sẵn UUID (guard idempotency) rồi insert ───────────
  // Gán id TRƯỚC khi insert: nếu job chết sau insert nhưng trước khi ghi lead_id, chạy
  // lại sẽ dùng lại id đã gán (WHERE lead_id IS NULL không match) → ON CONFLICT(id) DO
  // NOTHING → không tạo lead trùng. (ADR-002: thiếu email vẫn import, bỏ qua exact dedupe.)
  await db.execute(sql`
    UPDATE import_rows
    SET lead_id = gen_random_uuid()
    WHERE batch_id = ${batchId} AND validation_error IS NULL
      AND email_normalized IS NULL AND lead_id IS NULL
  `)
  const noEmailRows = await execRows<{ inserted: number }>(
    db,
    sql`
      WITH ins AS (
        INSERT INTO leads (
          id, email, email_normalized, full_name, full_name_normalized, full_name_sorted,
          company_name, company_name_normalized, title, industry, company_size, phone, phone_valid
        )
        SELECT
          lead_id, email, email_normalized, full_name, full_name_normalized, full_name_sorted,
          company_name, company_name_normalized, title, industry, company_size, phone, phone_valid
        FROM import_rows
        WHERE batch_id = ${batchId} AND validation_error IS NULL
          AND email_normalized IS NULL AND lead_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT count(*)::int AS inserted FROM ins
    `,
  )
  const noEmailInserted = noEmailRows[0]?.inserted ?? 0

  // ── (4) Ghi lead_sources cho mọi dòng hợp lệ ────────────────────────────────────
  // Guard NOT EXISTS theo (import_batch_id, row_number) → chạy lại batch không ghi trùng
  // nguồn. Re-import cùng file bằng BATCH MỚI vẫn ghi nguồn mới (batch_id khác) — AC-2.
  await db.execute(sql`
    INSERT INTO lead_sources (lead_id, import_batch_id, source_type, row_number, raw_data)
    SELECT ir.lead_id, ${batchId}, ${sourceType}, ir.row_number, ir.raw
    FROM import_rows ir
    WHERE ir.batch_id = ${batchId} AND ir.validation_error IS NULL AND ir.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM lead_sources ls
        WHERE ls.import_batch_id = ${batchId} AND ls.row_number = ir.row_number
      )
  `)

  return { inserted: emailInserted + noEmailInserted, updated: emailUpdated }
}
