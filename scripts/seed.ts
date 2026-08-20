/**
 * CLI cho seed demo: `npm run seed` (cần DATABASE_URL trong .env.local).
 * ⚠️ XOÁ data cũ. Logic thật nằm ở src/lib/demo/seed.ts — dùng chung với POST /api/admin/reset (ADR-009).
 */
import { getDb } from '../src/db/client'
import { seedDemoData } from '../src/lib/demo/seed'

seedDemoData(getDb(), (msg) => console.log(msg))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
