# SoT — Nhật ký quyết định (ADR log)

> Mỗi quyết định 3–6 dòng: ngày, quyết định, lý do. Thêm vào CUỐI file. Không sửa entry cũ (nếu đảo ngược → viết entry mới trỏ về entry bị đảo).

## ADR-001 — Hạ tầng: Railway + Supabase + 1 process (2026-08-19)
Next.js + pg-boss chạy CÙNG process (boot qua `src/instrumentation.ts`), deploy Railway (persistent, không cold-start); Postgres trên Supabase free (không tính compute-giờ nên pg-boss polling không cháy quota — loại Neon vì lý do này; loại Vercel vì serverless không chạy được worker nền). Kết nối qua Supavisor session mode, `postgres-js` với `prepare: false`. Hệ quả: đúng nguyên tắc brief §3.2 — 1 process + 1 DB.

## ADR-002 — Lead thiếu email: chấp nhận import (2026-08-19)
`email_normalized` nullable + partial unique index. Lead thiếu email bỏ qua exact dedupe, vẫn tham gia fuzzy. Lý do: reject làm mất data thật (CSV thực tế đầy dòng thiếu email — brief §7.2); partial index khiến nhánh này gần như miễn phí.

## ADR-003 — Idempotency là thiết kế, không phải may mắn (2026-08-19)
Mọi bước import set-based + upsert: job chết giữa chừng → chạy lại từ đầu vô hại (brief §7.3). Unique index trên `email_normalized` bao gồm CẢ lead archived; import trúng email của bản archived sẽ redirect nguồn qua `merged_into_id` → không hồi sinh dupe đã merge (câu #7 brief §4).

## ADR-004 — Ngôn ngữ UI: tiếng Anh (2026-08-19)
Portfolio hướng cả nhà tuyển dụng quốc tế; dữ liệu demo và cột `reason` của AI giữ tiếng Việt để thể hiện xử lý tiếng Việt (fold dấu). Tài liệu nội bộ (SoT) tiếng Việt.

## ADR-005 — Giới hạn trigram được ghi nhận (2026-08-19)
Viết tắt kiểu "TCB" vs "Techcombank" (golden pair #15) nằm ngoài khả năng pg_trgm → chấp nhận false negative, không flag bừa. Ghi vào README mục trade-offs.

## ADR-006 — Auth demo 1-click (2026-08-19)
Nút "Enter demo" tạo session cookie ký (jose HS256, 7 ngày), proxy.ts chặn route chưa có session. Không password — tối ưu cho "5 phút của người xem" (brief §8). Roles đã cắt nên auth chỉ còn vai trò rào cửa + kể chuyện middleware.

## ADR-007 — AI model qua env, mặc định Haiku 4.5 (2026-08-19)
`AI_SCORING_MODEL=claude-haiku-4-5` ($1/$5 per MTok — top-200 lead ≈ vài cent/lần chấm). Đổi model = đổi env, không đổi code. Structured output bằng strict tool use; cache theo input_hash; retry SDK + pg-boss.
