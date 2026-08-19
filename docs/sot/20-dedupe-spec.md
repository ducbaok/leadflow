# SoT — Dedupe spec (F2)

> Chuẩn vàng: `tests/fixtures/golden-pairs.json` (15 cặp — acceptance criteria dạng chạy được).
> **Điều kiện dừng tuning**: golden set pass 100%. Không tinh chỉnh thêm nếu chưa sửa golden set (chống tinh chỉnh vô hạn — brief §7.1).

## Tầng 1 — Exact (chạy ngay lúc import, luồng A)

- Khóa: `email_normalized` (quy tắc trong `10-data-model.md`).
- Cơ chế: partial UNIQUE index + `INSERT ... ON CONFLICT DO UPDATE` (điền chỗ trống).
- Idempotency: import lại cùng file → 0 lead mới; `lead_sources` vẫn ghi batch mới.
- Chiếm ~80% giá trị dedupe (brief §3.3).

## Tầng 2 — Fuzzy flag (job `dedupe:scan`, luồng D)

### Sinh candidate pairs (set-based trong Postgres, KHÔNG app-side)

```
Ứng viên = cặp lead active (archived_at IS NULL), a.id < b.id, thoả MỘT trong hai tier:
  Tier 1: similarity(full_name_sorted)  ≥ 0.55  AND  similarity(company_name_normalized) ≥ 0.30
  Tier 2: similarity(full_name_sorted)  ≥ 0.90  AND  similarity(company_name_normalized) ≥ 0.20
```

- `similarity()` = `pg_trgm`; index GIN `gin_trgm_ops` trên `full_name_sorted` và `company_name_normalized` (migration `0001`).
- Threshold là **4 hằng số config** (`T1_NAME=0.55, T1_COMPANY=0.30, T2_NAME=0.90, T2_COMPANY=0.20`) — giá trị khởi điểm, luồng D tune đến khi golden set pass rồi **khoá lại và cập nhật file này**.
- Vì sao 2 tier: Tier 2 bắt "tên trùng tuyệt đối + công ty mẹ/con" (golden #14 Grab/Grab Financial Group) mà không mở cửa cho "tên trùng + công ty khác hẳn" (golden #9 Viettel/VNPT).
- Vì sao `full_name_sorted`: bắt đảo thứ tự tên (golden #13 "Vũ Thị Mai"/"Mai Vũ").
- Cặp có `email_normalized` bằng nhau không bao giờ tới đây (đã gom ở tầng 1).

### Idempotency

- `pair_hash = sha256(min(idA,idB) || ':' || max(idA,idB))` — UNIQUE.
- Re-scan: `INSERT ... ON CONFLICT (pair_hash) DO NOTHING` → cặp đã quyết (`merged`/`not_duplicate`) không bao giờ bị re-flag (AC-12).
- Lead id ổn định qua re-import (upsert giữ id) → pair_hash ổn định.

## State machine quyết định

```
pending ──"Giữ bản này"──▶ merged        (keptLeadId = bản giữ)
pending ──"Không trùng"──▶ not_duplicate (không bao giờ hỏi lại)
```

**Khi `merged`** (một transaction, luồng D):
1. Bản không giữ: `archived_at = now()`, `merged_into_id = keptLeadId`
2. `lead_sources` của bản archive → repoint `lead_id = keptLeadId`
3. Mọi lead khác có `merged_into_id` = bản archive → update trỏ tới `keptLeadId` (giữ bất biến "merged_into luôn trỏ lead active")
4. Các `dedupe_pairs` pending khác chứa bản archive → decision tự động `merged`? **KHÔNG** — giữ pending nhưng UI hiển thị thay bằng bản kept (đơn giản MVP: chỉ cần lọc pair có lead archived ra khỏi hàng đợi review, đánh dấu `not_duplicate` tự động kèm audit note)
5. `lead_scores` của bản archive giữ nguyên (lịch sử), bản archive biến mất khỏi dashboard (mọi query lead mặc định `archived_at IS NULL`)
6. Audit: `dedupe.merged` ghi cả hai id

**Không có undo** ở MVP (đã cắt — 00-scope.md).

## Ràng buộc test (luồng D + F)

- Test harness nạp 15 cặp golden vào DB test, chạy pipeline exact + scan fuzzy, so kết quả với `expected`:
  - `duplicate` (kind exact) → phải gom còn 1 lead
  - `duplicate`/`suspect` (kind fuzzy) → phải có mặt trong `dedupe_pairs`
  - `not_duplicate` → không được xuất hiện trong `dedupe_pairs`
- Chạy trong CI. Golden #15 là trade-off được chấp nhận (README).
