# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-alpine AS build-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

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
COPY --from=build-deps /app/node_modules ./node_modules
COPY --from=source /app ./
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV KURA_AUTO_MIGRATE=true
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Use target-platform node_modules so Prisma engines generated/downloaded during
# the image build match the runtime architecture without runtime downloads.
COPY --from=prisma /app/node_modules ./node_modules
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY --from=prisma /app/node_modules ./node_modules
COPY --from=source /app/package.json /app/package-lock.json* /app/prisma.config.ts /app/tsconfig.json ./
COPY --from=source /app/prisma ./prisma
COPY --from=source /app/src ./src
CMD ["npm", "run", "worker"]
