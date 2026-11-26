# Build context: repository root (see docker-compose.yml)
FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY apps/api/package.json apps/api/
RUN npm install -w @adi/api

COPY apps/api apps/api
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 4000

# No migrations exist yet, so the schema is pushed directly. Replace with
# `prisma migrate deploy` once the first migration is committed.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
