# Optional Node API image for Fly / Render free allowances.
# Persistent data: set CODEFRIENDS_LIBSQL_URL (Turso free) — local SQLite
# on these hosts is lost when the machine sleeps or is recycled.
# Preferred $0 production path is apps/worker (Cloudflare D1 + Durable Objects).

FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/connect-client/package.json packages/connect-client/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/popout/package.json apps/popout/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY extensions/cursor/package.json extensions/cursor/package.json

RUN npm ci

COPY packages/shared packages/shared
COPY packages/core packages/core
COPY apps/server apps/server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

CMD ["npm", "run", "start", "-w", "@codefriends/server"]
