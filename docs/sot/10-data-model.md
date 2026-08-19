# SoT — Data model (ngữ nghĩa)

> DDL thật nằm ở `src/db/schema.ts` (SoT cấu trúc). File này ghi **ngữ nghĩa và lý do** — không lặp lại DDL.
> Đổi schema.ts hoặc file này → tuân thủ quy tắc SoT trong CLAUDE.md.

## Quy tắc normalize (code: `src/lib/normalize/`)

| Field | Quy tắc | Chốt |
|---|---|---|
| `email_normalized` | trim + lowercase mọi domain. **Chỉ với gmail.com/googlemail.com**: bỏ dấu chấm local part, strip `+suffix`, googlemail→gmail. Không hợp lệ → NULL | Áp gmail rule cho domain khác = merge nhầm lead công ty khác (brief §5) |
| `full_name_normalized` | fold dấu TV (đ→d) + lowercase + bỏ punctuation + gọn khoảng trắng | |
| `full_name_sorted` | token của `full_name_normalized` sort alphabet — đầu vào fuzzy match, bắt đảo tên ("Vu Thi Mai"/"Mai Vu") | |
| `company_name_normalized` | như trên + bỏ tiền tố pháp lý VN ("công ty cổ phần…") + hậu tố EN (ltd, jsc, corp…) | |
| `phone_valid` | `libphonenumber-js` mức valid/invalid, default country VN. NULL = không có số. **Không normalize sâu** ở MVP | brief §5 |

## Ngữ nghĩa bảng

### `leads` — bản ghi chuẩn sau dedupe
- **`email_normalized` nullable** — lead thiếu email vẫn được import (ADR-002): bỏ qua exact dedupe, vẫn tham gia fuzzy.
- **Partial unique index** trên `email_normalized WHERE NOT NULL`, **bao gồm cả lead đã archive**. Lý do: import lại email của bản đã bị archive phải conflict vào bản cũ rồi **redirect qua `merged_into_id`** — không được hồi sinh bản dupe (câu hỏi #7 brief §4). 
- `merged_into_id` **luôn trỏ tới lead ACTIVE**. Khi lead đích bị merge tiếp, mọi con trỏ cũ phải được update chuyển tiếp (trách nhiệm luồng D, set-based).
- `status` chỉ đổi qua dashboard/API — **import không bao giờ ghi đè status**.

### Chính sách upsert khi promote (luồng A)
- Conflict theo `email_normalized` → **điền chỗ trống, không ghi đè** (`COALESCE(leads.field, excluded.field)`): import cũ không phá dữ liệu user đã chỉnh. Cập nhật `updated_at`.
- File chứa **cùng email nhiều dòng** → `DISTINCT ON (email_normalized)` lấy dòng cuối trước khi upsert (các dòng còn lại vẫn ghi `lead_sources`).
- Nguồn (`lead_sources`) gắn vào `COALESCE(merged_into_id, id)` của lead conflict.

### `import_batches` / `import_rows`
- `import_rows` là **staging**: upload xong đổ thô vào đây (raw jsonb), job normalize + validate + promote **set-based bằng SQL** — không row-by-row qua ORM (quyết định không thương lượng, brief §3.1).
- `validation_error != NULL` → dòng lỗi, đếm vào `error_rows`, hiển thị "dòng N: lỗi X". Batch vẫn hoàn thành.
- `duration_ms` là nguồn đo AC-1 (10k < 30s).
- Vòng đời batch: `pending` (đã stage, chờ mapping) → `processing` → `completed` | `failed`.
- **Job chết giữa chừng** → chạy lại từ đầu là vô hại **theo thiết kế** (mọi bước set-based + upsert idempotent) — ADR-003.

### `dedupe_pairs`
- `pair_hash = sha256(min(idA,idB) + ':' + max(idA,idB))`, UNIQUE — re-scan `ON CONFLICT DO NOTHING` → cặp đã quyết không bao giờ bị hỏi lại (idempotency fuzzy).
- Chi tiết state machine + threshold: `20-dedupe-spec.md`.

### `lead_scores`
- UNIQUE(lead_id, kind), kind ∈ {rule, ai} — **hai cột điểm tách biệt, không bao giờ cộng gộp** (brief §6).
- `input_hash`: hash các field đầu vào (danh sách trong `30-scoring-spec.md`) — trùng hash → không gọi lại AI.

### `audit_log`
- Mọi mutation ghi qua `src/lib/audit.ts` (cùng transaction với mutation). Action namespace: `import.*`, `lead.*`, `dedupe.*`, `scoring.*`.
