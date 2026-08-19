# Lead-Gen Automation SaaS — Project Brief

> Tài liệu bàn giao context. Trạng thái: **chưa viết code**, thư mục dự án trống.
> Mục tiêu dự án: **portfolio** (không phải sản phẩm thương mại).

---

## 1. Dự án này là gì

Công cụ cho **dân sales B2B**. "Lead" = khách hàng tiềm năng (một người/công ty có thể mua sản phẩm).

Quy trình thủ công đang thay thế:
1. Sales lên LinkedIn/Apollo tìm danh sách người theo tiêu chí (vd: "CTO các công ty fintech VN")
2. Đổ vào Google Sheets — mỗi người một file, mỗi chiến dịch một file
3. Hậu quả: cùng một người xuất hiện ở 3 file (tên viết khác, email khác), không ai biết liên hệ ai trước, ai đã liên hệ rồi
4. Sales tốn thời gian email cho người không bao giờ mua

Sản phẩm giải quyết: **import** → **dedupe** (gom bản trùng) → **score** (xếp hạng ưu tiên) → **dashboard** (làm việc + theo dõi phễu New → Contacted → Qualified → Won/Lost).

*Không phải* chấm điểm CV. Cấu trúc giống nhau (nhận hồ sơ về người → chấm theo tiêu chí → xếp hạng) nhưng câu hỏi khác: CV hỏi "người này làm được việc không?", lead hỏi "người này có khả năng **mua hàng của tôi** không?".

---

## 2. Spec gốc (rút gọn)

**F1 — Ingestion:** Import CSV (map cột thủ công) + adapter API (Apollo/mock). Validate email/phone, đánh dấu record lỗi thay vì reject cả file. 10k dòng không block UI.

**F2 — Dedupe (phần lõi):** Exact match theo email normalized; fuzzy match tên công ty + tên người (threshold cấu hình được); merge hoặc flag cho user quyết; giữ lịch sử nguồn. **Bắt buộc idempotent** — import lại cùng file không tạo bản trùng mới.

**F3 — Scoring:** Rule-based cấu hình bằng JSON (ngành, quy mô công ty, chức danh). Tùy chọn AI scoring bằng LLM (điểm + lý do ngắn). Cache kết quả, không gọi lại nếu lead chưa đổi.

**F4 — Dashboard:** Bảng lead với filter/sort/pagination **server-side**, cập nhật trạng thái, export CSV danh sách đã lọc.

**F5 — (sau MVP):** Email sequence, SendGrid/Resend, track open/click, unsubscribe.

**Non-functional:** Import 10k < 30s; retry API ngoài với exponential backoff (tối đa 3 lần); audit trail.

**Ngoài scope (giữ nguyên, chống scope creep):** multi-tenant billing, email deliverability/domain warm-up, tích hợp CRM bên thứ 3.

---

## 3. Quyết định đã chốt

### 3.1 Tech stack

| Thành phần | Chọn | Lý do |
|---|---|---|
| Full-stack | **Next.js** (API routes luôn trong đó) | Một repo, một deploy. **Bỏ Fastify/NestJS riêng** |
| DB | **Postgres** (Neon hoặc Supabase) | Free tier, làm được cả jsonb lẫn fuzzy search |
| ORM | **Drizzle** | Nhẹ, TypeScript-first |
| Job queue | **pg-boss** | Chạy trên chính Postgres. **Bỏ Redis + BullMQ** — bớt hạ tầng phải vận hành và trả tiền |
| Fuzzy match | **`pg_trgm` + GIN index** | Bắt buộc, không dùng thư viện string-similarity |
| Frontend | Tailwind + TanStack Query + **TanStack Table** | Table cần cho sort/filter/pagination server-side |

**`pg_trgm` là quyết định không thương lượng:** so sánh Levenshtein phía app trên 10k lead là O(n²) = 100 triệu phép so → vỡ. Pattern đúng: trigram index lọc candidate pairs trong DB trước, rồi mới chấm điểm tinh trên tập nhỏ.

**Mục tiêu 10k < 30s:** đạt được **nếu** bulk insert vào staging table rồi dedupe/scoring bằng SQL set-based. **Trượt** nếu xử lý row-by-row qua ORM. Đây là quyết định kiến trúc phải chốt từ đầu.

### 3.2 Nguyên tắc chọn stack (để tham chiếu về sau)

1. Stack không quyết định thành bại — **việc hoàn thành** mới quyết định
2. Đếm số "mảnh hạ tầng phải sống": ít process = ít thứ hỏng = ít tiền hosting
3. Một ngôn ngữ xuyên suốt (TypeScript cả hai đầu) — đừng thêm Python "vì AI"
4. **Chọn theo nơi deploy, không chỉ nơi dev** — portfolio bắt buộc có link demo sống
5. Chọn nhanh rồi đi tiếp; phân vân tốn hơn khác biệt thực tế

### 3.3 Cắt scope

- **Bỏ hoàn toàn user roles** (Owner/Sales member) → single user. Phân quyền là code nhàm, tốn 3–4 ngày, không ai tuyển vì middleware check role.
- **Dedupe chia 3 tầng, MVP chỉ làm tầng 1 + 2 + archive:**
  1. Exact match email normalized — dễ, chiếm ~80% giá trị. `UNIQUE INDEX` + upsert giải quyết luôn idempotency
  2. Fuzzy flag "nghi trùng" — trung bình, `pg_trgm` + GIN
  3. Merge field-level thật — **để sau MVP**. Thay bằng "chọn bản giữ lại, bản kia archive"

---

## 4. Vì sao merge UI khó (không phải vì UI)

Vẽ form 2 lead cạnh nhau + radio chọn field là việc một buổi chiều. Cái khó là **ngữ nghĩa dữ liệu bên dưới**. Ví dụ 2 lead nghi trùng:

- **A:** `nguyen.van.a@gmail.com`, "FPT Software", status **Qualified**, assign Lan, 3 bản ghi nguồn, score 85
- **B:** `nguyenvana@gmail.com`, "FPT", status **New**, assign Minh, 1 bản ghi nguồn, score 40

Bấm "Merge" thì hệ thống phải trả lời **7 câu hỏi**, tất cả phải chốt *trước khi* code UI:

1. Field nào thắng? "FPT Software" hay "FPT"? Tự động hay bắt user chọn từng field?
2. Status nào giữ? Qualified + New → Qualified, nhưng **Won + Lost** thì sao?
3. Assignment: Lan hay Minh sở hữu? Người kia có được báo không?
4. 4 bản ghi nguồn phải repoint foreign key về lead còn lại; audit trail cả hai phải giữ
5. Score tính lại hay giữ? Cache scoring cũ giờ vô hiệu
6. Undo được không? "Un-merge" nghĩa là gì khi dữ liệu đã trộn?
7. Import lần sau file cũ chứa cả A lẫn B — hệ thống phải nhớ "cặp này đã merge" để không tạo lại B

Giải pháp MVP "giữ một bản, archive bản kia" né được câu 1, 2, 5, 6 mà vẫn demo được luồng dedupe.

---

## 5. Data model — bổ sung so với spec gốc

Spec gốc có: `leads`, `lead_sources`, `scoring_rules`, `users` + `lead_assignments`.

**Thiếu 2 bảng quan trọng:**

- **`import_batches`** — track progress, đếm record lỗi, hiển thị "dòng 341 sai định dạng email" thay vì reject cả file
- **`dedupe_decisions`** (pair_hash, decision, decided_by, decided_at) — **idempotency cho fuzzy dupes**: import lại cùng file không được re-flag các cặp user đã quyết "không trùng". Thiếu bảng này thì mỗi lần import user phải xử lý lại từ đầu.

*(Bỏ `users` + `lead_assignments` nếu cắt roles như mục 3.3.)*

**Chi tiết dễ sai:**
- **Gmail normalization:** bỏ dấu chấm **chỉ đúng với `gmail.com`/`googlemail.com`**, đừng áp cho domain khác (sẽ merge nhầm lead công ty khác). Cân nhắc strip cả `+suffix`.
- **Phone validation:** dùng `libphonenumber-js` ở mức valid/invalid thôi, đừng cố normalize sâu ở MVP.

---

## 6. AI Scoring — user muốn làm feature này

### Vì sao cần, khi đã có rule-based

Rule-based chỉ so khớp field cứng: chức danh chứa "CFO" → +30, công ty 20–500 người → +25, ngành bán lẻ/sản xuất → +15. Nó **không** biết "Head of Finance Operations" cũng là người quyết định như CFO, **không** đọc được mô tả công ty để hiểu "startup 10 người vừa gọi vốn 5 triệu đô" là khách ngon.

### Luồng kỹ thuật

1. User viết mô tả ICP (Ideal Customer Profile) bằng văn xuôi
2. Background job gửi LLM: mô tả ICP + thông tin lead
3. LLM trả JSON có cấu trúc: `{ "score": 78, "reason": "Kế toán trưởng tại công ty sản xuất ~200 người — đúng người quyết định, đúng cỡ công ty" }`
4. Lưu DB; dashboard hiện điểm **kèm lý do** cạnh điểm rule-based

### 4 điều bắt buộc làm đúng

- **Cache theo hash** — hash các field liên quan của lead; lead không đổi thì không gọi lại API. Không có cái này thì mỗi lần mở dashboard đốt tiền một lần.
- **Chạy nền, KHÔNG chạy lúc import** — 10k lead × 1 API call sẽ phá vỡ mục tiêu import < 30s. Import xong rồi job scoring chạy sau. Tối ưu chi phí: **rule-based lọc thô miễn phí → AI chấm tinh chỉ top N**.
- **Structured output** — không nhận văn xuôi tự do rồi tự parse; dùng structured output/tool-use để ép đúng JSON schema, kèm retry + exponential backoff khi API lỗi.
- **Hai cột điểm tách biệt** — đừng trộn AI score vào rule score thành một số. Hiện cả hai; chỗ chúng lệch nhau nhiều chính là chỗ thú vị.

### Vì sao đây là feature portfolio tốt

Cái "wow" khi demo **không phải con số mà là cột lý do** — mỗi lead có một dòng giải thích như người thật viết. README kể được: cache, hash để biết khi nào chấm lại, structured output, retry backoff, chạy nền. Đó là khác biệt giữa "gọi API cho có AI" và "tích hợp LLM có kỷ luật kỹ thuật".

---

## 7. Điểm mù trong spec (xếp theo mức nguy hiểm)

1. **Không có acceptance criteria.** "Fuzzy match tên công ty" — threshold bao nhiêu thì flag? "FPT" với "FPT Software" có phải một? Không định nghĩa trước → tinh chỉnh vô hạn. **Cách chữa rẻ nhất: viết 10–15 cặp ví dụ cụ thể (trùng / không trùng / nghi ngờ) làm chuẩn — nó thành bộ test luôn.**

2. **Lead không có email thì sao?** Toàn bộ dedupe và idempotency treo trên `email_normalized`, nhưng CSV thực tế đầy dòng thiếu email. Phải quyết: reject (đơn giản, ghi rõ) hay nhánh xử lý riêng.

3. **Job chết giữa chừng thì sao?** Import 10k chết ở dòng 6.000: chạy lại từ đầu hay resume? Nếu idempotent đúng thì đáp án là "chạy lại từ đầu, vô hại" — nhưng phải ghi rõ đó là **thiết kế**, không phải may mắn.

4. **Bảo mật:** giới hạn kích thước file upload; và **CSV injection** — lead tên `=HYPERLINK(...)` khi export ra CSV sẽ được Excel thực thi. Phải escape ô bắt đầu bằng `=`, `+`, `-`, `@`. Nhỏ nhưng đưa vào README rất ghi điểm.

5. **Seed data — điểm mù lớn nhất với portfolio.** Dashboard trống = portfolio chết. Cần script Faker sinh vài nghìn lead giả **có chủ đích cài dupes vào** để demo dedupe, + 2–3 file CSV mẫu để ai xem cũng import thử được ngay. **Tuyệt đối không demo bằng dữ liệu người thật cào từ LinkedIn** — rủi ro pháp lý và xấu hồ sơ.

6. **GDPR hiện chỉ là trang trí.** Audit trail ≠ GDPR; GDPR thật cần xóa/export dữ liệu theo yêu cầu. Để ngoài scope là đúng, nhưng README nên nói thẳng "audit trail là bước chuẩn bị, chưa phải tuân thủ đầy đủ".

---

## 8. Portfolio đổi hàm mục tiêu

Sản phẩm thật tối ưu cho *giá trị người dùng*; portfolio tối ưu cho *bằng chứng năng lực trong 5 phút của người xem*.

- **Cắt roles hoàn toàn** (đã nêu mục 3.3)
- **Dồn chiều sâu vào dedupe engine** — đó là phần có "thịt" kỹ thuật: O(n²) giải bằng trigram index, idempotency, bảng quyết định. Test kỹ riêng nó + một mục README giải thích **tại sao** thiết kế vậy. Một module sâu + giải thích tốt > năm feature nông.
- **README là mặt tiền:** kiến trúc 1 hình vẽ, GIF demo 30 giây, link demo sống, và mục **"trade-offs & những gì tôi cắt và vì sao"** — mục này phân biệt người hiểu kỹ thuật với người code theo tutorial. Nguyên liệu cho nó nằm sẵn trong tài liệu này.

---

## 9. Ước lượng thời gian

1 dev full-stack có kinh nghiệm, làm cùng Claude Code:

| Hạng mục | Ước lượng |
|---|---|
| Setup, schema, auth cơ bản | 3–4 ngày |
| F1: import CSV + mapping UI + background job + progress | 4–6 ngày |
| F2: dedupe (exact + fuzzy flag + review đơn giản) | 5–8 ngày |
| F3: rule-based scoring (+ AI scoring) | 2–4 ngày |
| F4: dashboard, status flow, export CSV | 4–6 ngày |
| Test, polish, edge case | 3–5 ngày |

- **Đúng spec như viết (đã cắt merge field-level): 4–6 tuần**
- **Cắt mạnh (bỏ roles, dedupe chỉ exact + flag, scoring hardcode 1 file JSON): 2–3 tuần**

Biến số lớn nhất là review/merge UI của F2 — mỗi mức "kỹ" thêm ở đó dễ cộng một tuần.

*Lưu ý: CSV column mapping UI nghe đơn giản nhưng gồm preview vài dòng đầu, đoán cột, lưu mapping template. Tính ít nhất 2 ngày riêng.*

---

## 10. Thứ tự build khuyến nghị

1. **Schema + import pipeline** — xương sống, mọi thứ khác đứng trên nó
2. **Dashboard sơ khai ngay sau** — để *nhìn thấy* data, debug import dễ hơn nhiều
3. **Dedupe làm lặp:** exact → fuzzy flag → review UI
4. **Scoring cuối cùng** vì độc lập nhất (rule-based trước, AI sau)

---

## 11. Bước tiếp theo

Scaffold dự án theo stack đã chốt: **Next.js + Drizzle + Postgres/Neon + pg-boss**, kèm:
- Schema đầy đủ (gồm `import_batches` + `dedupe_decisions`)
- Kiến trúc staging-table cho import set-based
- Script seed data Faker **có cài dupes chủ đích**
- Module AI scoring có cache + queue đàng hoàng ngay từ đầu
