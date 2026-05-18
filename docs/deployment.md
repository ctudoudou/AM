# Deployment And Development

This document keeps operational details out of the product README.

## Docker Compose

Compose starts PostgreSQL, aria2, the Kura web app, a one-shot migration
container, and the worker:

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:3000/zh-Hans
```

The Compose setup stores app data under `${KURA_DATA_ROOT:-./data}` and mounts
it at `/data` inside the Kura containers.

## Local Development

Use this mode when PostgreSQL and aria2 already exist on your machine or
network:

```bash
cp .env.example .env
npm install
npm run prisma:migrate:dev
npm run dev
```

Run the background worker in a second terminal:

```bash
npm run worker
```

The development server defaults to:

```text
http://localhost:3000/zh-Hans
```

## Existing PostgreSQL And aria2

Kura can be deployed as only `web` and `worker` containers when PostgreSQL and
aria2 are already provided by your NAS or another Compose stack. Set
`DATABASE_URL`, `ARIA2_RPC_URL`, and the `/data` directory variables to values
reachable from both Kura containers.

Do not use `localhost` for PostgreSQL or aria2 unless the service runs in the
same container. Inside Docker, `localhost` is the current container.

For Unraid-style deployments, see [unraid-deployment.md](unraid-deployment.md).

## Environment Variables

Do not commit real API keys, aria2 secrets, NAS hostnames, NAS IPs, or private
registry names. Use `.env.example` as a template and keep real values in `.env`
or your container platform secrets.

| Variable | Required | Description | Example |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by web, worker, and Prisma. | `postgresql://kura:password@postgres:5432/kura?schema=public` |
| `POSTGRES_PASSWORD` | Compose | PostgreSQL password used by the bundled Compose database. Change it before exposing the database. | `change-me` |
| `KURA_DATA_ROOT` | Compose | Host-side data root used by `docker-compose.yml` volume mappings. | `./data` |
| `DATA_ROOT` | Yes | Container-visible root for all Kura-managed files. | `/data` |
| `ANIME_LIBRARY_DIR` | Yes | Anime library directory. | `/data/library/anime` |
| `MOVIES_LIBRARY_DIR` | Yes | Movie library directory. | `/data/library/movies` |
| `TV_LIBRARY_DIR` | Yes | TV library directory. | `/data/library/tv` |
| `DOWNLOADS_DIR` | Yes | aria2/Kura downloads directory. | `/data/downloads` |
| `IMPORT_ROOT` | Yes | Manual import scan root. | `/data/import` |
| `STAGING_DIR` | Recommended | Temporary staging directory for organization work. | `/data/staging` |
| `METADATA_DIR` | Recommended | Metadata, artwork, and local cache directory. | `/data/metadata` |
| `TRANSCODES_DIR` | Recommended | HLS/transcode output directory. | `/data/transcodes` |
| `OPENROUTER_API_KEY` | Optional | Enables AI-assisted candidate grouping and organizer review. | empty or secret |
| `OPENROUTER_MODEL` | Optional | OpenRouter model name. | `glm5.1` |
| `TMDB_API_KEY` | Optional | Optional movie/TV metadata provider. | empty or secret |
| `OMDB_API_KEY` | Optional | Optional metadata compatibility source for movies and TV. | empty or secret |
| `ARIA2_RPC_URL` | Yes | aria2 JSON-RPC endpoint reachable from Kura. | `http://aria2:6800/jsonrpc` |
| `ARIA2_RPC_SECRET` | Recommended | aria2 RPC secret; must match aria2. Use a strong value outside local development. | `change-me` |
| `KURA_AUTO_MIGRATE` | Container | When `true`, the web image runs `prisma:migrate:deploy` at startup. | `true` |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | Optional | Default UI locale. | `zh-Hans` |

All configured file roots should stay under `DATA_ROOT` for predictable NAS
safety checks.

## Common Tasks

Run database migrations:

```bash
npm run prisma:migrate:dev      # local development
npm run prisma:migrate:deploy   # deployed environments
```

Build and start the production app:

```bash
npm run build
npm run start
```

Run the worker:

```bash
npm run worker
```

Trigger common jobs through the web API:

```bash
curl -X POST http://localhost:3000/api/jobs/run \
  -H 'Content-Type: application/json' \
  -d '{"job":"library.scan"}'

curl -X POST http://localhost:3000/api/jobs/run \
  -H 'Content-Type: application/json' \
  -d '{"job":"rss.fetchAll"}'

curl -X POST http://localhost:3000/api/jobs/run \
  -H 'Content-Type: application/json' \
  -d '{"job":"organizer.inspectCompletedDownloads"}'
```

Scan the media library directly:

```bash
curl -X POST http://localhost:3000/api/library/scan
```

Scan the import directory and create organizer plans:

```bash
curl -X POST http://localhost:3000/api/organizer/import-scan \
  -H 'Content-Type: application/json' \
  -d '{"mediaType":"AUTO"}'
```

Submit a manual magnet:

```bash
curl -X POST http://localhost:3000/api/intake/magnet \
  -H 'Content-Type: application/json' \
  -d '{"mediaType":"AUTO","magnetUrl":"magnet:?xt=urn:btih:EXAMPLE"}'
```

Execute an organizer plan after reviewing it in the UI:

```bash
curl -X POST http://localhost:3000/api/organizer/plans/<plan-id>/execute
```

Useful job names:

```text
rss.fetchAll
rss.parseItems
ai.groupCandidates
ai.repairCandidateGroups
subscriptions.matchNewCandidates
downloads.syncAria2
organizer.inspectCompletedDownloads
organizer.cleanupPollutedPlans
organizer.cleanupStalePlans
organizer.aiReviewPlans
organizer.autoExecuteReadyPlans
library.scan
library.mergeDuplicateAnimeTitles
library.repairEpisodeNumbering
```

## Architecture

- `web`: Next.js App Router UI and API.
- `worker`: background process backed by PostgreSQL/pg-boss schedules.
- `postgres`: application database.
- `aria2`: BT/magnet downloader controlled through JSON-RPC.
- `ffmpeg`: installed in container images for HLS/transcode preparation.

The worker schedules RSS fetches, aria2 sync, and automatic organizer execution.
The web app can also trigger jobs manually through `/api/jobs/run`.

## Screenshot Capture

README screenshots can be regenerated from a running Kura instance:

```bash
KURA_SCREENSHOT_BASE_URL=http://localhost:3000 node scripts/capture-readme-screenshots.mjs
```

## Safety Notes

- Keep `.env` private.
- Do not commit real NAS paths that identify your home network.
- Do not commit private API keys, aria2 RPC secrets, or private Docker registry
  names.
- Review organizer plans before executing them, especially after adding a new
  library root or import source.
- Back up PostgreSQL and `/data/library` before large organizer runs.

## Development Checks

```bash
npm run lint
npm run test
npm run build
```
