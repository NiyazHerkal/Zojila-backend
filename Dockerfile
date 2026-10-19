# Multi-stage build: compile TypeScript in a full image, ship only the compiled
# output + production deps in a slim runtime image (smaller, smaller attack surface).
#
# Using bookworm-slim (Debian, glibc) rather than alpine (musl) — bcrypt is a native
# module and its prebuilt binaries target glibc; alpine would force a from-source
# compile that needs extra build tooling for no real size benefit here.

FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Uploaded receipts and feedback screenshots. Mount a persistent volume here (see docs/DEPLOYMENT.md);
# without one they're lost on every redeploy.
ENV UPLOAD_DIR=/app/uploads

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# Don't run as root.
USER node

EXPOSE 3000
# Pending database migrations run at start-up (DB_MIGRATIONS_RUN, default true).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
