# syntax=docker/dockerfile:1
# Đóng gói production cho Railway — ADR-009. Chạy thử local:
#   docker build -t leadflow . && docker run -p 3000:3000 -e DATABASE_URL=... -e SESSION_SECRET=... leadflow

FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
# NEXT_OUTPUT_STANDALONE bật output:'standalone' (next.config.ts) — chỉ cho image này
ENV NEXT_TELEMETRY_DISABLED=1     NEXT_OUTPUT_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build KHÔNG cần DATABASE_URL: db/client.ts lazy, mọi route chạm DB đều force-dynamic
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrate lúc deploy (railway.json → preDeployCommand: node scripts/migrate.mjs).
# drizzle-kit là devDependency nên KHÔNG có ở đây; migrate.mjs chỉ cần 2 package dưới,
# cả hai đều không có transitive dependency nên copy thẳng là đủ.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
