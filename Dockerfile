# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/root/.cache/prisma \
    for attempt in 1 2 3 4 5; do \
      npm run prisma:generate && break; \
      if [ "$attempt" = "5" ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache ffmpeg
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/root/.cache/prisma \
    for attempt in 1 2 3 4 5; do \
      npm run prisma:generate && break; \
      if [ "$attempt" = "5" ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done
CMD ["npm", "run", "worker"]
