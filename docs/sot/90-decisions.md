# SoT — Nhật ký quyết định (ADR log)

> Mỗi quyết định 3–6 dòng: ngày, quyết định, lý do. Thêm vào CUỐI file. Không sửa entry cũ (nếu đảo ngược → viết entry mới trỏ về entry bị đảo).

## ADR-001 — Hạ tầng: Railway + Supabase + 1 process (2026-08-19)
Next.js + pg-boss chạy CÙNG process (boot qua `src/instrumentation.ts`), deploy Railway (persistent, không cold-start); Postgres trên Supabase free (không tính compute-giờ nên pg-boss polling không cháy quota — loại Neon vì lý do này; loại Vercel vì serverless không chạy được worker nền). Kết nối qua Supavisor session mode, `postgres-js` với `prepare: false`. Hệ quả: đúng nguyên tắc brief §3.2 — 1 process + 1 DB.

## ADR-002 — Lead thiếu email: chấp nhận import (2026-08-19)
`email_normalized` nullable + partial unique index. Lead thiếu email bỏ qua exact dedupe, vẫn tham gia fuzzy. Lý do: reject làm mất data thật (CSV thực tế đầy dòng thiếu email — brief §7.2); partial index khiến nhánh này gần như miễn phí.

## ADR-003 — Idempotency là thiết kế, không phải may mắn (2026-08-19)
Mọi bước import set-based + upsert: job chết giữa chừng → chạy lại từ đầu vô hại (brief §7.3). Unique index trên `email_normalized` bao gồm CẢ lead archived; import trúng email của bản archived sẽ redirect nguồn qua `merged_into_id` → không hồi sinh dupe đã merge (câu #7 brief §4).

**Bằng chứng hồi quy**: `tests/integration/kill-worker.test.ts` (AC-14) — SIGKILL tiến trình import THẬT giữa chừng (`status='processing'`) rồi chạy lại, kết quả cuối hội tụ đúng số lead/nguồn tính bằng chính `normalizeMappedRow` của luồng A.

## ADR-004 — Ngôn ngữ UI: tiếng Anh (2026-08-19)
Portfolio hướng cả nhà tuyển dụng quốc tế; dữ liệu demo và cột `reason` của AI giữ tiếng Việt để thể hiện xử lý tiếng Việt (fold dấu). Tài liệu nội bộ (SoT) tiếng Việt.

## ADR-005 — Giới hạn trigram được ghi nhận (2026-08-19)
Viết tắt kiểu "TCB" vs "Techcombank" (golden pair #15) nằm ngoài khả năng pg_trgm → chấp nhận false negative, không flag bừa. Ghi vào README mục trade-offs.

## ADR-006 — Auth demo 1-click (2026-08-19)
Nút "Enter demo" tạo session cookie ký (jose HS256, 7 ngày), proxy.ts chặn route chưa có session. Không password — tối ưu cho "5 phút của người xem" (brief §8). Roles đã cắt nên auth chỉ còn vai trò rào cửa + kể chuyện middleware.

## ADR-007 — AI model qua env, mặc định Haiku 4.5 (2026-08-19)
`AI_SCORING_MODEL=claude-haiku-4-5` ($1/$5 per MTok — top-200 lead ≈ vài cent/lần chấm). Đổi model = đổi env, không đổi code. Structured output bằng strict tool use; cache theo input_hash; retry SDK + pg-boss.

## ADR-008 — Thêm `aiStatus` (additive) vào GET /api/leads (2026-08-20)
Batch 2 luồng E: `GET /api/leads` thêm field `aiStatus: 'pending'|'completed'|'failed'|null` (join `lead_scores.status` của bản `kind='ai'`; null = chưa từng chấm). Lý do: shape cũ chỉ có `aiScore` nên "đang chấm" (pending, score=NULL) và "chưa chấm" (không có bản ai) trùng hình → không hiện được badge "Scoring…" theo 30-scoring-spec §3. Field CHỈ thêm (không đổi `ruleScore/aiScore/aiReason`), mirror `scores[].status` mà `GET /api/leads/:id` đã trả. Đồng bộ cùng commit: `40-api-contracts.md`, `src/app/api/leads/route.ts`, `src/components/leads/types.ts`, bảng leads.
