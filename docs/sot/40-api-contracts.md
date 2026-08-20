# SoT — API contracts + Job contracts

> **Bề mặt chung giữa các luồng song song — ĐÓNG BĂNG ở Batch 0.** Luồng nào cần đổi shape ở đây: DỪNG → notify user (quy tắc CLAUDE.md) → sửa đồng bộ file này + code + các luồng bị ảnh hưởng.
> Quy ước chung: lỗi trả `{ "error": string }` + HTTP status; body/query validate bằng zod; mọi route (trừ `/api/auth/*`) yêu cầu session cookie.

## Jobs (pg-boss) — code: `src/jobs/contracts.ts`

| Job | Payload | Ai gửi | Ai xử lý |
|---|---|---|---|
| `import.process` | `{ batchId: uuid }` | POST /api/imports/:id/start | Luồng A |
| `dedupe.scan` | `{ batchId?: uuid }` (thiếu = quét toàn cục) | POST /api/dedupe/scan; cuối import.process | Luồng D |
| `score.rules` | `{ leadIds?: uuid[] }` (thiếu = toàn bộ active) | PUT config; POST /api/scoring/run | Luồng C |
| `score.ai` | `{ leadIds: uuid[] }` (đã là top-N, chunk ≤ 25) | POST /api/scoring/run | Luồng C |

Queue options (mọi queue): `retryLimit: 3, retryBackoff: true, retryDelay: 5`.

## Auth
| Route | Req | Res |
|---|---|---|
| `POST /api/auth/demo` | — | 303 → `/leads`, set cookie session 7 ngày |

## Leads (luồng B sở hữu)

### `GET /api/leads`
Query: `page` (1-based, mặc định 1), `pageSize` (mặc định 25, max 100), `sort` ∈ {createdAt, fullName, companyName, companySize, status, ruleScore, aiScore}, `order` ∈ {asc, desc}, `status?`, `industry?`, `search?` (ILIKE trên tên/email/công ty).
Mặc định chỉ trả lead active (`archived_at IS NULL`).

```jsonc
// 200
{
  "rows": [{
    "id": "uuid", "fullName": "...", "email": "...", "companyName": "...", "title": "...",
    "industry": "...", "companySize": 200, "phone": "...", "phoneValid": true,
    "status": "new", "createdAt": "ISO",
    "ruleScore": 55,          // null nếu chưa chấm
    "aiScore": 78,            // null nếu chưa chấm
    "aiReason": "...",        // null nếu chưa chấm
    "aiStatus": "pending"     // 'pending' | 'completed' | 'failed' | null (null = chưa từng chấm AI)
  }],
  "total": 5304, "page": 1, "pageSize": 25
}
```
(Score fields `ruleScore/aiScore/aiReason` có mặt trong shape NGAY TỪ ĐẦU — Batch 1 luồng B trả null, Batch 2 luồng E join `lead_scores`; ba field này không đổi. `aiStatus` được THÊM (additive) ở Batch 2 để phân biệt "đang chấm" với "chưa chấm" cho badge per-row — mirror `scores[].status` mà `GET /api/leads/:id` đã trả. Xem ADR-008.)

### `GET /api/leads/:id`
`{ lead: LeadRow, sources: [{ id, sourceType, rowNumber, rawData, createdAt, batchFilename }], scores: [{ kind, score, reason, model, scoredAt, status }] }`

### `PATCH /api/leads/:id`  — body `{ "status": "contacted" }` → `{ "ok": true }` (+ audit `lead.status_changed`)

### `GET /api/leads/export`
Query = như GET /api/leads (bỏ page/pageSize). Res: `text/csv` stream, **mọi ô bắt đầu bằng `=` `+` `-` `@` được prefix `'`** (luồng B, `src/lib/export/`).

## Imports (luồng A sở hữu)

| Route | Req | Res |
|---|---|---|
| `POST /api/imports` | multipart `file` (CSV ≤ 20MB) | `{ batchId, headers: string[], preview: string[][], guessedMapping: Record<string, string \| null> }` — parse + đổ thô vào `import_rows`, batch `pending` |
| `POST /api/imports/:batchId/start` | `{ mapping: Record<csvHeader, LeadField \| null>, templateName?: string }` | `{ ok: true }` — lưu mapping (+ template nếu có tên), enqueue `import.process` |
| `GET /api/imports` | — | `{ batches: [{ id, filename, sourceType, status, totalRows, validRows, errorRows, insertedLeads, updatedLeads, durationMs, createdAt }] }` |
| `GET /api/imports/:batchId` | — | batch + `errors: [{ rowNumber, message }]` (tối đa 100 dòng đầu) — nguồn cho progress polling |
| `GET /api/imports/templates` | — | `{ templates: [{ id, name, mapping }] }` |

`LeadField` ∈ `fullName | email | companyName | title | industry | companySize | phone` (cột CSV map `null` = bỏ qua).

## Dedupe (luồng D sở hữu)

| Route | Req | Res |
|---|---|---|
| `GET /api/dedupe/pairs?status=pending&page=1` | — | `{ pairs: [{ id, nameSimilarity, companySimilarity, createdAt, a: LeadSnapshot, b: LeadSnapshot }], total }` — LeadSnapshot gồm các field hiển thị + số nguồn + status + scores |
| `POST /api/dedupe/pairs/:id/decision` | `{ decision: "merged", keptLeadId } \| { decision: "not_duplicate" }` | `{ ok: true }` — transaction theo 20-dedupe-spec.md |
| `POST /api/dedupe/scan` | — | `{ ok: true }` — enqueue `dedupe.scan` |

## Scoring (luồng C sở hữu)

| Route | Req | Res |
|---|---|---|
| `GET /api/scoring/config` | — | `{ icpDescription, rules, aiTopN }` |
| `PUT /api/scoring/config` | `{ icpDescription?, rules?, aiTopN? }` (zod validate theo 30-scoring-spec) | `{ ok: true }` + enqueue `score.rules` nếu rules đổi |
| `POST /api/scoring/run` | `{ "kind": "rule" \| "ai" }` | `{ ok: true, enqueued: number, capped?: true }` — kind=ai: chọn top-N rồi chunk 25/job. **429** `{ error }` nếu còn trong cooldown (xem Rào chi phí AI bên dưới) |
| `GET /api/scoring/status` | — | `{ ruleScored, aiScored, aiPending, aiFailed }` |

### Rào chi phí AI (thêm ở Batch 3 — ADR-010)

`POST /api/scoring/run` với `kind: "ai"` chịu 2 rào cấu hình bằng env, **mặc định TẮT** (trống → hành vi y hệt trước Batch 3):

| Env | Ý nghĩa | Trống = |
|---|---|---|
| `AI_MAX_LEADS_PER_RUN` | N thực tế = `min(scoring_config.ai_top_n, giá trị này)`. Bị cắt → response có `capped: true` | không clamp |
| `AI_RUN_COOLDOWN_SECONDS` | Khoảng cách tối thiểu giữa 2 lần chạy AI. Vi phạm → **429** `{ error }`, không enqueue, không ghi audit `run_requested` | 0s (không cooldown) |

Cooldown đọc lần chạy trước từ `audit_log` (action `scoring.run_requested`, `payload.kind = 'ai'`) — không thêm bảng, không thêm cột.
Lý do tồn tại: demo là link public, mỗi lần chấm AI là tiền thật gọi API. Chỉ môi trường demo set 2 env này; local/CI để trống.

## Ops (luồng G sở hữu — Batch 3)

| Route | Req | Res |
|---|---|---|
| `GET /api/health` | — (**miễn session** — Railway healthcheck gọi; ngoại lệ duy nhất ngoài `/api/auth/*`) | `{ ok: boolean, db: "up" \| "down", boss: "up" \| "down" }`. 200 khi `db = "up"`, ngược lại **503** |
| `POST /api/admin/reset` | header `x-admin-token` khớp env `ADMIN_RESET_TOKEN` (**miễn session** — token thay cookie, để gọi bằng curl) | `{ ok: true, leads: number }` — TRUNCATE + seed lại demo (`src/lib/demo/seed.ts`, dùng chung với `npm run seed`). **401** sai/thiếu token; **503** khi `ADMIN_RESET_TOKEN` chưa đặt (route coi như không bật) |

`/api/admin/reset` là hành động phá huỷ và chạy đồng bộ (~5.1k lead) — cố ý không có UI, chỉ gọi bằng `curl`.
