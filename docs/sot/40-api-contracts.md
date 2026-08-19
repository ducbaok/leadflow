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
    "aiReason": "..."         // null nếu chưa chấm
  }],
  "total": 5304, "page": 1, "pageSize": 25
}
```
(Score fields có mặt trong shape NGAY TỪ ĐẦU — Batch 1 luồng B trả null, Batch 2 luồng E join `lead_scores`. Shape không đổi.)

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
| `POST /api/scoring/run` | `{ "kind": "rule" \| "ai" }` | `{ ok: true, enqueued: number }` — kind=ai: chọn top-N rồi chunk 25/job |
| `GET /api/scoring/status` | — | `{ ruleScored, aiScored, aiPending, aiFailed }` |
