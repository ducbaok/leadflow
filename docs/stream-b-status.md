# Stream B — Dashboard F4 · Trạng thái & Bàn giao

> File ghi chú (không phải SoT, chưa commit). Nơi lưu tình trạng đang mở của luồng B để phiên sau / lúc merge nhìn lại.

- **Ngày:** 2026-08-20
- **Branch / worktree:** `stream/b-dashboard` @ `E:\SAAS1-B`
- **Commit:** `76289f4` — "Batch 1 · Stream B: Dashboard F4 (leads table, detail, CSV export)"
- **Cổng dev:** `npm run dev -- -p 3002`

## 1. Đã xong & đã verify thật (DB seed 5.154 lead)

| Hạng mục | Kết quả |
|---|---|
| `GET /api/leads` server-side sort/filter/pagination, `archived_at IS NULL` | warm **13–25ms** → **AC-5 pass** |
| `GET /api/leads/:id` (`{lead, sources, scores}`) | shape khớp SoT |
| `PATCH /api/leads/:id` đổi status + audit `lead.status_changed {from,to}` | pass; bad uuid→400, not found→404, status sai→400 |
| `GET /api/leads/export` CSV stream, BOM UTF-8, escape `= + - @` | 4 lead injection đều bị vô hiệu hoá → **AC-6 pass** |
| `src/lib/export/csv.ts` unit test | 15/15 (toàn repo 36/36) |
| typecheck + lint | sạch |

**Shape đóng băng giữ nguyên:** `GET /api/leads` trả `ruleScore/aiScore/aiReason = null`. Luồng E (Batch 2) join `lead_scores` mà **không đổi shape**.

## 2. ⚠️ Quyết định đang MỞ — cần user duyệt (đụng SoT)

**"Lịch sử" ở trang chi tiết lead.** Đề bài yêu cầu "danh sách nguồn + lịch sử".

- **Hiện tại (đã làm):** hiểu "lịch sử" = **timeline nguồn / provenance** — mỗi `lead_sources` là một bản ghi thu thập (batch, row #, thời điểm, raw data). Hoàn toàn nằm trong contract `GET /api/leads/:id` đang đóng băng `{lead, sources, scores}`. **Không đụng SoT.**
- **Nếu user muốn "lịch sử đổi status" từ `audit_log`:** phải **thêm field mới** (vd `history: [...]`) vào response `GET /api/leads/:id` → **đổi `docs/sot/40-api-contracts.md`** = thay đổi SoT.
  - Quy trình bắt buộc (CLAUDE.md): DỪNG → thông báo diff + file phụ thuộc → user duyệt → sửa đồng bộ + thêm ADR vào `docs/sot/90-decisions.md`, tất cả trong 1 commit.
  - **Trạng thái: CHƯA làm, đang chờ quyết định của user.**

## 3. Quyết định thuộc quyền luồng B (KHÔNG phải SoT, đã áp dụng)

- **State bảng giữ trong URL** (`page/pageSize/sort/order/status/industry/search`) → export bám đúng filter hiện hành, refresh/back giữ nguyên bộ lọc. `page.tsx` bọc `<Suspense>` vì `useSearchParams` (Next 16).
- **Đổi status KHÔNG ép state-machine phía server** — cho phép mọi status hợp lệ trong enum (SoT `PATCH` chỉ định nghĩa `{status}`, không có máy trạng thái cho lead như bên dedupe). Dropdown xếp theo phễu New→Contacted→Qualified→Won/Lost cho đúng UX. Nếu muốn chặn nhảy cóc → là thay đổi hành vi, báo trước.
- **Sort theo `ruleScore/aiScore`**: nhận param hợp lệ (giữ enum contract) nhưng **fallback `createdAt`** vì chưa join `lead_scores` — cột "Score" hiển thị placeholder, chưa cho sort ở Batch 1. Luồng E sẽ wire sort thật.
- **Sort tên/công ty** dùng cột `*_normalized` (đã fold dấu) cho thứ tự alphabet tiếng Việt đẹp hơn.
- `industry` filter: hardcode 10 giá trị domain trong `src/components/leads/types.ts` (khớp `src/lib/demo/seed.ts`) — không tạo thêm API distinct ngoài SoT.

## 4. Lưu ý vận hành / môi trường

- **Next 16 typegen:** `RouteContext<>` và `LayoutProps` là **global do `next dev`/`next build`/`npx next typegen` sinh ra** (`.next/types`, đã gitignore). Chạy `tsc --noEmit` một mình khi chưa typegen sẽ báo `Cannot find name 'LayoutProps'` ở `src/app/layout.tsx` — **lỗi hạ tầng có sẵn, KHÔNG phải code luồng B**. Route `[id]` đã cố ý dùng kiểu `params: Promise<{id:string}>` tường minh để không phụ thuộc `RouteContext`.
- **TanStack Table v9** (không phải v8): `useTable` + `tableFeatures`, manual server-side. Skills tham chiếu ở `node_modules/@tanstack/react-table/skills/`.
- **Dev server :3002** có thể vẫn đang chạy từ phiên trước (tiến trình nền) — Ctrl-C hoặc kill nếu cần khởi động lại.

## 5. Ranh giới đã tôn trọng

- Chỉ tạo/sửa trong: `src/app/(dashboard)/leads/`, `src/app/api/leads/`, `src/components/leads/`, `src/lib/export/`, `tests/unit/export.test.ts`.
- **Không** đụng bất kỳ file SoT nào (`docs/sot/**`, `src/db/schema.ts`, `src/jobs/contracts.ts`, `tests/fixtures/golden-pairs.json`).
- **Không** thêm dependency (dùng `@tanstack/react-table`, `@tanstack/react-query`, `zod`, `drizzle-orm` đã có).
