# SoT — Scoring spec (F3)

> Hai hệ điểm **độc lập, không bao giờ cộng gộp** (brief §6): `rule` (miễn phí, tức thời) và `ai` (LLM, chạy nền, có cache). Dashboard hiện cả hai + lý do AI.

## 1. Rule-based (`score:rules`)

Config trong bảng `scoring_config.rules` (singleton id=1). JSON schema:

```jsonc
{
  "version": 1,
  "rules": [
    // op quyết định các tham số còn lại; field lấy từ leads
    { "field": "title",       "op": "contains_any", "values": ["cfo", "ke toan truong"], "points": 30 },
    { "field": "companySize", "op": "between",      "min": 20, "max": 500,               "points": 25 },
    { "field": "industry",    "op": "in",           "values": ["manufacturing"],          "points": 15 },
    { "field": "phoneValid",  "op": "equals",       "value": true,                        "points": 10 },
    { "field": "email",       "op": "is_company_domain",                                  "points": 10 }
  ]
}
```

- **Ops**: `contains_any` (so trên chuỗi fold dấu + lowercase), `in`, `between` (đóng 2 đầu), `equals`, `is_company_domain` (domain ∉ danh sách free mail: gmail/yahoo/outlook/hotmail/icloud).
- `score = min(100, Σ points các rule khớp)`. Field NULL → rule đó không khớp (không trừ điểm).
- Chạy set-based cho toàn bộ lead active; ghi `lead_scores(kind='rule')` upsert theo (lead_id, kind).
- Đổi config → API enqueue `score:rules` chấm lại toàn bộ (rẻ).

## 2. AI scoring (`score:ai`)

### Luồng (4 điều bắt buộc — brief §6)
1. **Chạy nền, không bao giờ lúc import.** Trigger duy nhất: user bấm "Chấm AI" → API chọn **top-N lead theo rule score** (N = `scoring_config.ai_top_n`, mặc định 200, chỉ lead active) → enqueue `score:ai` theo chunk 25 lead/job.
2. **Cache theo hash**: bỏ qua lead có `lead_scores(kind='ai').input_hash` trùng hash hiện tại.
3. **Structured output**: strict tool use ép schema — không parse văn xuôi.
4. **Retry**: SDK Anthropic `maxRetries` + pg-boss retry (3 lần, backoff). Lỗi 1 lead → ghi `status='failed'` + `error`, KHÔNG fail cả job.

### Input hash
```
input_hash = sha256(JSON({ fullName, title, companyName, industry, companySize, emailDomainType, phoneValid })
                    + PROMPT_VERSION + model + icpDescription)
```
- `emailDomainType`: 'company' | 'free' | 'none'.
- Đổi ICP, model, hoặc PROMPT_VERSION → hash đổi → chấm lại. Lead không đổi → **0 API call** (AC-7).

### Contract với LLM
- Model: env `AI_SCORING_MODEL` (mặc định `claude-haiku-4-5`), key `ANTHROPIC_API_KEY`.
- Input: ICP (văn xuôi của user) + thông tin lead (các field trong hash).
- Output (strict tool schema): `{ "score": <int 0-100>, "reason": "<string, tiếng Việt, ≤ 240 ký tự>" }`.
- `reason` là điểm "wow" của demo — hiển thị cạnh điểm, tooltip đầy đủ.
- `PROMPT_VERSION` là hằng số trong `src/lib/scoring/` — bump khi đổi prompt.

## 3. Hiển thị (luồng B/E)
- 2 cột: "Rule" và "AI" (kèm icon lý do). Chỗ hai điểm lệch nhau nhiều là điểm thú vị — không che giấu.
- Lead chưa chấm AI: hiện "—" + badge "đang chấm" nếu job pending.
