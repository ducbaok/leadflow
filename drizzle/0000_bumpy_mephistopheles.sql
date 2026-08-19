CREATE TYPE "public"."dedupe_decision" AS ENUM('pending', 'merged', 'not_duplicate');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."score_kind" AS ENUM('rule', 'ai');--> statement-breakpoint
CREATE TYPE "public"."score_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dedupe_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_hash" text NOT NULL,
	"lead_a_id" uuid NOT NULL,
	"lead_b_id" uuid NOT NULL,
	"name_similarity" real,
	"company_similarity" real,
	"decision" "dedupe_decision" DEFAULT 'pending' NOT NULL,
	"kept_lead_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text,
	"source_type" text DEFAULT 'csv' NOT NULL,
	"status" "import_batch_status" DEFAULT 'pending' NOT NULL,
	"mapping" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"inserted_leads" integer DEFAULT 0 NOT NULL,
	"updated_leads" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"email" text,
	"email_normalized" text,
	"full_name" text,
	"full_name_normalized" text,
	"full_name_sorted" text,
	"company_name" text,
	"company_name_normalized" text,
	"title" text,
	"industry" text,
	"company_size" integer,
	"phone" text,
	"phone_valid" boolean,
	"validation_error" text,
	"lead_id" uuid
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "score_kind" NOT NULL,
	"score" integer,
	"reason" text,
	"input_hash" text,
	"model" text,
	"status" "score_status" DEFAULT 'completed' NOT NULL,
	"error" text,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"row_number" integer,
	"raw_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"email_normalized" text,
	"full_name" text,
	"full_name_normalized" text,
	"full_name_sorted" text,
	"company_name" text,
	"company_name_normalized" text,
	"title" text,
	"industry" text,
	"company_size" integer,
	"phone" text,
	"phone_valid" boolean,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"archived_at" timestamp with time zone,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "scoring_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"icp_description" text,
	"rules" jsonb NOT NULL,
	"ai_top_n" integer DEFAULT 200 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dedupe_pairs" ADD CONSTRAINT "dedupe_pairs_lead_a_id_leads_id_fk" FOREIGN KEY ("lead_a_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedupe_pairs" ADD CONSTRAINT "dedupe_pairs_lead_b_id_leads_id_fk" FOREIGN KEY ("lead_b_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedupe_pairs" ADD CONSTRAINT "dedupe_pairs_kept_lead_id_leads_id_fk" FOREIGN KEY ("kept_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_id_leads_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dedupe_pairs_pair_hash_unique" ON "dedupe_pairs" USING btree ("pair_hash");--> statement-breakpoint
CREATE INDEX "dedupe_pairs_decision_idx" ON "dedupe_pairs" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "import_rows_batch_id_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_scores_lead_kind_unique" ON "lead_scores" USING btree ("lead_id","kind");--> statement-breakpoint
CREATE INDEX "lead_sources_lead_id_idx" ON "lead_sources" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_sources_batch_id_idx" ON "lead_sources" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_normalized_unique" ON "leads" USING btree ("email_normalized") WHERE email_normalized IS NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");