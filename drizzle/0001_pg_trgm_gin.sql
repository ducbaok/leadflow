-- pg_trgm là quyết định không thương lượng của brief §3.1:
-- trigram GIN index lọc candidate pairs TRONG DB (O(n²) app-side sẽ vỡ ở 10k lead).
-- WITH SCHEMA public để operator class gin_trgm_ops luôn resolve được
-- bất kể search_path (Supabase mặc định cài extension vào schema "extensions").
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_full_name_sorted_trgm_idx" ON "leads" USING gin ("full_name_sorted" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_company_normalized_trgm_idx" ON "leads" USING gin ("company_name_normalized" gin_trgm_ops);
