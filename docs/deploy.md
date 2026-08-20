# Runbook — deploy LeadFlow lên Railway

Tài liệu **phái sinh**: mọi quyết định đằng sau nằm ở [ADR-009 / ADR-010](sot/90-decisions.md), contract route ở [40-api-contracts.md](sot/40-api-contracts.md §Ops).
Đây chỉ là thứ tự bấm nút + cách kiểm tra.

## 0. Cần sẵn

| Thứ | Lấy ở đâu |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string, **Session pooler (port 5432)**, không phải transaction pooler 6543 |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ADMIN_RESET_TOKEN` | `openssl rand -hex 24` |

## 1. Tạo service

Railway → **New Project → Deploy from GitHub repo** → chọn repo. Không cần chọn builder: `railway.json` đã khai `DOCKERFILE`.

## 2. Đặt biến môi trường

Service → **Variables**:

```
DATABASE_URL=<session pooler URL>
SESSION_SECRET=<hex 32>
ANTHROPIC_API_KEY=<key>
AI_SCORING_MODEL=claude-haiku-4-5
AI_MAX_LEADS_PER_RUN=25
AI_RUN_COOLDOWN_SECONDS=60
ADMIN_RESET_TOKEN=<hex 24>
```

2 biến `AI_*` là **rào chi phí cho demo public** (ADR-010) — local và CI để trống.
Không đặt `PORT`: Dockerfile đã đặt 3000 và Railway tự map.

## 3. Domain

Service → Settings → Networking → **Generate Domain**. Đây là link dán vào README.
Bản đang chạy: https://leadflow-production-56de.up.railway.app

## 4. Deploy

Mỗi lần push lên `main`, Railway:
1. build `Dockerfile` (3 stage → image chỉ có `.next/standalone` + static),
2. chạy `preDeployCommand: node scripts/migrate.mjs` — migrate bằng drizzle-orm, **không** cần drizzle-kit,
3. start `node server.js`; pg-boss boot cùng process qua `src/instrumentation.ts`,
4. healthcheck `GET /api/health` (timeout 120s) — không xanh thì Railway rollback.

## 5. Nạp dữ liệu demo (lần đầu, và mỗi khi demo bị bẩn)

```bash
curl -X POST -H "x-admin-token: $ADMIN_RESET_TOKEN" https://<domain>/api/admin/reset
```

Xoá sạch rồi seed lại 5.154 lead (250 lead nhiều nguồn, 150 cặp fuzzy, 4 lead CSV-injection). Chạy đồng bộ — đo thật: ~1,5s với Postgres local, ~25s qua Supavisor pooler tới Supabase.
Seed **không** tạo điểm — sau khi reset, vào `/settings` bấm **Score with rules** để dashboard có cột điểm.
Muốn có sẵn cặp trùng chờ review: gọi `POST /api/dedupe/scan` (hoặc nút Scan ở `/dedupe`).

## 6. Kiểm tra sau deploy

```bash
BASE=https://<domain> npm run smoke
```

Chỉ đọc, không ghi — kiểm health, rào session, login demo, dashboard có data, dedupe, scoring status, escape CSV injection.

Tái kiểm toàn bộ acceptance criteria (AC-18):

```bash
BASE=https://<domain> node scripts/verify-acceptance.mjs
```

> ⚠️ Lệnh này **GHI ~10k lead thật** vào DB đích và sửa `aiTopN`. Chạy xong phải reset lại bằng bước 5.

## 7. Khi hỏng

| Triệu chứng | Nguyên nhân hay gặp |
|---|---|
| Deploy fail ở preDeploy, log `TypeError: Invalid URL` | **Giá trị env dính dấu nháy.** Railway KHÔNG bóc `"` như file `.env` — dán `"postgresql://…"` vào ô Variables thì dấu nháy thành một phần của giá trị. Local không lộ vì Node `--env-file` và Next đều bóc nháy. Kiểm cả 7 biến, không chỉ `DATABASE_URL` |
| Deploy fail ở preDeploy, log `DATABASE_URL chưa được đặt` | Biến chưa vào service, hoặc thêm sau khi deploy đã chạy → Redeploy |
| Deploy fail ở preDeploy, lỗi kết nối | Dùng transaction pooler 6543 thay vì session pooler 5432, hoặc sai mật khẩu (mật khẩu có ký tự mã hoá URL — giữ nguyên từng ký tự) |
| Healthcheck đỏ, log `db: down` | Supabase project bị pause, hoặc IP allowlist |
| `/api/health` trả `boss: "down"` | pg-boss không start được → job import/dedupe/scoring nằm im. Xem log container |
| Nút "Score with AI" trả 429 | Đúng thiết kế — `AI_RUN_COOLDOWN_SECONDS` đang chặn (ADR-010) |
| Nút "Score with AI" chạy nhưng không ra điểm | Thiếu `ANTHROPIC_API_KEY` → job bỏ qua an toàn, `lead_scores.status='failed'` |
| `/api/admin/reset` trả 503 | Chưa đặt `ADMIN_RESET_TOKEN` |

## Chạy image này ở local (giống hệt production)

```bash
docker build -t leadflow .
docker run --rm -p 3000:3000 -e DATABASE_URL=... -e SESSION_SECRET=... leadflow
```
