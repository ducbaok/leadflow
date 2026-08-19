# SoT — Phạm vi (Scope)

> Nguồn sự thật về **cái gì được build, cái gì không**. Đổi file này → tuân thủ quy tắc SoT trong CLAUDE.md.
> Bối cảnh đầy đủ: PROJECT-BRIEF.md. Kế hoạch thực thi: xem plan đã duyệt (batches A–H).

## Trong scope (MVP)

| Feature | Bao gồm | Luồng |
|---|---|---|
| **F1 Ingestion** | Upload CSV ≤ 20MB; mapping cột thủ công (preview 20 dòng, đoán cột, lưu template); staging table + bulk insert; validate email/phone mức valid/invalid; lỗi đánh dấu **từng dòng**, không reject cả file; exact dedupe (upsert theo `email_normalized`) ngay lúc promote; background job + progress polling; adapter interface + **Apollo mock** adapter | A, E |
| **F2 Dedupe** | Tầng 1: exact match email normalized (idempotent bằng unique index). Tầng 2: fuzzy flag bằng `pg_trgm` (threshold trong 20-dedupe-spec.md). Review UI: **chỉ 2 hành động** "Giữ bản này" (bản kia archive) / "Không trùng". Bảng `dedupe_pairs` nhớ mọi quyết định — re-import không hỏi lại | D |
| **F3 Scoring** | Rule-based từ JSON config (schema trong 30-scoring-spec.md). AI scoring: Claude qua env `AI_SCORING_MODEL`, structured output, cache theo `input_hash`, chạy nền, chỉ chấm top-N theo rule score. **2 cột điểm tách biệt** | C |
| **F4 Dashboard** | Bảng lead: filter/sort/pagination **server-side**; đổi status theo phễu New→Contacted→Qualified→Won/Lost; export CSV theo filter + escape injection; trang chi tiết lead (nguồn + lịch sử) | B |

## Đã cắt (có chủ đích — không thêm lại nếu chưa sửa file này)

- **User roles / phân quyền** → single user, auth demo 1-click (ADR-006)
- **Merge field-level** → thay bằng "giữ một bản, archive bản kia" (né 4/7 câu hỏi ngữ nghĩa merge — brief §4)
- **F5 email sequence** (SendGrid, open/click tracking, unsubscribe) → sau MVP
- **GDPR compliance thật** → audit trail chỉ là bước chuẩn bị; README nói thẳng điều này
- **Undo merge** → không có; quyết định merge là chung cuộc (MVP)

## Ngoài scope (chống scope creep — từ brief, giữ nguyên)

- Multi-tenant billing
- Email deliverability / domain warm-up
- Tích hợp CRM bên thứ ba

## Non-functional (bắt buộc)

- Import 10k dòng < 30s, không block UI
- Retry API ngoài: tối đa 3 lần, exponential backoff
- Audit trail cho mọi mutation
- Chặn CSV injection khi export (escape ô bắt đầu bằng `=` `+` `-` `@`)
- Upload giới hạn 20MB
