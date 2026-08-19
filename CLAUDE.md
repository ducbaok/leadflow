@AGENTS.md

# LeadFlow — Lead-Gen Automation SaaS (portfolio)

Import CSV → dedupe (exact + fuzzy pg_trgm) → scoring (rule + AI) → dashboard. Bối cảnh: `PROJECT-BRIEF.md`. Stack: Next.js 16 + Drizzle + Postgres (Supabase) + pg-boss (cùng process, boot qua `src/instrumentation.ts`) + Tailwind + TanStack Query/Table. Deploy: Railway.

## ⚠️ QUY TẮC SOURCE OF TRUTH — BẮT BUỘC

Các file SoT: `docs/sot/**`, `tests/fixtures/golden-pairs.json`, `src/db/schema.ts`, `src/jobs/contracts.ts`.

**Bất kỳ thay đổi nào vào file SoT phải:**
1. **DỪNG và THÔNG BÁO user TRƯỚC khi tiếp tục**: file nào đổi, tóm tắt diff, danh sách file/module phụ thuộc bị ảnh hưởng.
2. Sau khi user duyệt: sửa đồng bộ mọi file phụ thuộc **trong cùng một commit**, thêm 1 entry vào `docs/sot/90-decisions.md`.
3. Không bao giờ sửa im lặng. Code mâu thuẫn SoT → SoT thắng (hoặc flag cho user nếu nghi SoT sai).

README/comment là tài liệu **phái sinh** — không chứa thông tin SoT chưa có. Không phình tài liệu: mọi giải thích trỏ về SoT thay vì chép lại.

## Bản đồ SoT

| File | Nguồn sự thật về |
|---|---|
| `docs/sot/00-scope.md` | Phạm vi, danh sách đã cắt, non-functional |
| `docs/sot/10-data-model.md` | Ngữ nghĩa bảng/cột, quy tắc normalize, chính sách upsert |
| `docs/sot/20-dedupe-spec.md` | Threshold, pair_hash, state machine merge/archive |
| `docs/sot/30-scoring-spec.md` | Rule JSON schema, contract AI, input_hash, cache |
| `docs/sot/40-api-contracts.md` | Shape API routes + job payloads (bề mặt chung các luồng) |
| `docs/sot/90-decisions.md` | ADR log |
| `tests/fixtures/golden-pairs.json` | Chuẩn vàng dedupe (15 cặp) |
| `src/db/schema.ts` | DDL |

## Ownership map (luồng song song — không đụng thư mục luồng khác)

| Luồng | Thư mục sở hữu |
|---|---|
| A — Import (Batch 1) | `src/lib/import/`, `src/jobs/import.job.ts`, `src/app/api/imports/`, `src/app/(dashboard)/imports/`, `src/components/imports/` |
| B — Dashboard (Batch 1) | `src/app/(dashboard)/leads/`, `src/app/api/leads/`, `src/components/leads/`, `src/lib/export/` |
| C — Scoring (Batch 1) | `src/lib/scoring/`, `src/jobs/scoring.job.ts`, `src/app/api/scoring/`, `src/app/(dashboard)/settings/` |
| D — Dedupe (Batch 2) | `src/lib/dedupe/`, `src/jobs/dedupe.job.ts`, `src/app/api/dedupe/`, `src/app/(dashboard)/dedupe/`, `src/components/dedupe/` |
| E — Tích hợp (Batch 2) | `src/app/(dashboard)/leads/`, `src/components/leads/`, `src/lib/import/adapters/` |
| F — Test (Batch 2) | `tests/` (không sửa `src/` — bug thì báo luồng sở hữu) |

Nền tảng dùng chung (đã xong ở Batch 0, đổi = đổi SoT): `src/db/`, `src/jobs/boss.ts` + `contracts.ts`, `src/lib/normalize/`, `src/lib/audit.ts`, `src/lib/session.ts`.

## Lệnh

```bash
npm run dev          # Next dev (pg-boss tự boot nếu có DATABASE_URL)
npm run test         # vitest (tests/unit)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:generate  # drizzle-kit generate (sinh migration từ schema.ts)
npm run db:migrate   # drizzle-kit migrate (cần DATABASE_URL trong .env.local)
npm run seed         # seed 5k lead demo + dupes chủ đích (XÓA data cũ)
npm run samples      # sinh 3 CSV mẫu vào public/samples/
```

Env: xem `.env.example`. UI tiếng Anh, dữ liệu demo tiếng Việt (ADR-004).

## Nguyên tắc kiến trúc (từ brief — không thương lượng)

- Import 10k: bulk → staging (`import_rows`) → promote **set-based SQL**. Không row-by-row qua ORM.
- Fuzzy match: `pg_trgm` + GIN trong Postgres. Không thư viện string-similarity phía app.
- AI scoring: chạy nền, cache theo `input_hash`, structured output, không bao giờ chạy lúc import.
- Mọi mutation ghi audit qua `src/lib/audit.ts`.
- Export CSV phải escape `=` `+` `-` `@` (CSV injection).
