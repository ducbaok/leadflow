// Vitest setup — nạp biến môi trường cho integration test (DATABASE_URL, v.v.).
// Unit test không cần DB nhưng nạp ở đây vô hại. Nếu không có .env.local (vd. CI job
// "checks" không dựng Postgres) thì DATABASE_URL vẫn undefined → integration test tự skip
// (xem tests/integration/helpers/db.ts). Biến đã có sẵn trong process.env (CI) không bị ghi đè.
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'] })
