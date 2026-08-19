# Import — xử lý dòng lỗi (quyết định còn treo)

> **Trạng thái: PARKED (2026-08-20).** User chọn giữ nguyên hành vi hiện tại.
> Không code gì thêm cho tới khi có quyết định. File này = derived note (không phải SoT),
> nằm trong ownership luồng A. Xoá/di chuyển thoải mái khi đã chốt.

## Hiện tại một dòng lỗi bị xử lý thế nào

- Dòng fail validate → có `import_rows.validation_error`, **không promote** sang `leads`,
  đếm vào `import_batches.error_rows`. **Không huỷ dữ liệu**: raw vẫn nằm ở staging.
- Batch vẫn `completed` (không bao giờ reject cả file — SoT `00-scope.md`).
- User thấy lỗi qua `GET /api/imports/:id` → `errors: [{rowNumber, message}]` (tối đa 100)
  và danh sách "Row errors" trong wizard.
- Chưa có hành động khắc phục nào ngoài: sửa CSV rồi import lại (importer idempotent nên
  dòng tốt chỉ upsert, không nhân đôi).

Code liên quan: [`normalize-row.ts`](./normalize-row.ts) (quyết định dòng nào là lỗi),
[`../../app/api/imports/[batchId]/route.ts`](../../app/api/imports/%5BbatchId%5D/route.ts)
(trả `errors[]`), [`../../components/imports/import-wizard.tsx`](../../components/imports/import-wizard.tsx)
(hiển thị).

## Lever A — DÒNG NÀO tính là lỗi (chính sách; luồng A sở hữu, KHÔNG phải SoT)

| | Hành vi | Đánh đổi |
|---|---|---|
| **A1 — hiện tại** | email sai định dạng = lỗi; email THIẾU = lead-không-email; email+tên+công ty đều trống = lỗi | Email hỏng lộ rõ thay vì thành lead không dedupe được |
| A2 — dễ dãi | email sai → null, import thành lead-không-email; chỉ dòng rỗng hẳn mới lỗi | Gần như không có lỗi, nhưng email gõ sai âm thầm mất khả năng dedupe |
| A3 — warning vs error | email/phone/size sai = *cảnh báo mềm* (vẫn import, có cờ); chỉ thiếu-định-danh = *lỗi cứng* (bỏ) | Giữ dữ liệu tốt nhất, nhưng cần thêm khái niệm `warning` ở staging + UI |

## Lever B — LÀM GÌ với dòng lỗi (khắc phục/UX)

| | Công sức | Ghi chú |
|---|---|---|
| **B1 — hiện tại: report + import lại thủ công** | 0 | Sửa CSV, upload lại cả file. Idempotent nên an toàn. Đang chạy. |
| B2 — tải dòng lỗi ra CSV | nhỏ, trong luồng A | 1 endpoint dump các dòng fail + cột `error_reason`; user sửa đúng những dòng đó rồi upload lại. **Giá trị/công sức cao nhất.** |
| B3 — sửa inline & retry trong wizard | vừa/lớn | Bảng sửa ô lỗi, submit lại chỉ những dòng đó. Cần thêm UI + endpoint re-stage. |
| B4 — toggle "import luôn dòng invalid" | nhỏ | Cho user chọn A1↔A2 theo từng lần import. |

## Guardrail (bất di bất dịch)

- **Không bao giờ reject cả file** (SoT `00-scope.md` §non-functional). Muốn cảnh báo khi
  tỉ lệ lỗi cao → chỉ được hiện banner, không được fail batch.
- Bất kỳ thay đổi chính sách nào **KHÔNG** đụng file SoT — chỉ nằm trong `src/lib/import/`.

## Khuyến nghị khi quay lại

Giữ **A1** + thêm **B2** (nút "Download error rows"). Gọn, tự chứa trong luồng A, tạo vòng
lặp sửa-rồi-upload-lại hợp với importer idempotent. B3 để sau nếu muốn wizard bóng bẩy hơn.
