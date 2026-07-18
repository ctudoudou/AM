# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-alpine AS build-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM --platform=$BUILDPLATFORM node:24-alpine AS build-prisma
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.cache/prisma \
    for attempt in 1 2 3 4 5; do \
      npm run prisma:generate && break; \
      if [ "$attempt" = "5" ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM --platform=$BUILDPLATFORM node:24-alpine AS source
WORKDIR /app
COPY . .

FROM node:24-alpine AS prisma
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=source /app/package.json /app/package-lock.json* /app/prisma.config.ts ./
COPY --from=source /app/prisma ./prisma
RUN --mount=type=cache,target=/root/.cache/prisma \
    for attempt in 1 2 3 4 5; do \
      npm run prisma:generate && break; \
      if [ "$attempt" = "5" ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done

FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
WORKDIR /app
COPY --from=build-prisma /app/node_modules ./node_modules
COPY --from=source /app ./
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM --platform=$BUILDPLATFORM node:24-alpine AS worker-builder
WORKDIR /app
COPY --from=build-prisma /app/node_modules ./node_modules
COPY --from=source /app ./
RUN npm run build:worker

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV KURA_AUTO_MIGRATE=false
ENV VIDEO_RESOLVER_CHROMIUM_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium ffmpeg
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

FROM node:24-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prisma /app/node_modules ./node_modules
COPY --from=source /app/package.json /app/package-lock.json* /app/prisma.config.ts ./
COPY --from=source /app/prisma ./prisma
CMD ["npm", "run", "prisma:migrate:deploy"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=worker-builder /app/dist ./dist
COPY --from=prisma /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=prisma /app/node_modules/@prisma/client-runtime-utils ./node_modules/@prisma/client-runtime-utils
CMD ["node", "dist/worker.cjs"]

FROM alpine:3.22 AS mdns
RUN apk add --no-cache avahi
COPY docker-mdns-entrypoint.sh /usr/local/bin/docker-mdns-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-mdns-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-mdns-entrypoint.sh"]
