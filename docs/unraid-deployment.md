# Kura Unraid Deployment

This guide covers deploying Kura on Unraid when PostgreSQL and aria2 are already deployed separately.

## Containers

Deploy two Kura containers:

| Container | Image | Purpose |
| --- | --- | --- |
| `kura-web` | `ctudoudou/kura:latest` | Web UI and API |
| `kura-worker` | `ctudoudou/kura-worker:latest` | RSS jobs, download sync, organizer jobs, library scan |

`kura-web` can open the UI by itself, but background automation requires `kura-worker`.

## Recommended Host Directories

Create these directories on Unraid:

```text
/mnt/user/Kura/downloads
/mnt/user/Kura/staging
/mnt/user/Kura/library/anime
/mnt/user/Kura/library/movies
/mnt/user/Kura/library/tv
/mnt/user/Kura/metadata
/mnt/user/Kura/transcodes
```

Map the whole Kura data root into both containers:

```text
Host path:      /mnt/user/Kura
Container path: /data
Access mode:    Read/Write
```

## Environment Variables

Use the same environment variables for both `kura-web` and `kura-worker`.

Required:

```env
DATABASE_URL=postgresql://kura:your-password@your-postgres-host:5432/kura?schema=public

DATA_ROOT=/data
DOWNLOADS_DIR=/data/downloads
STAGING_DIR=/data/staging
ANIME_LIBRARY_DIR=/data/library/anime
MOVIES_LIBRARY_DIR=/data/library/movies
TV_LIBRARY_DIR=/data/library/tv
METADATA_DIR=/data/metadata
TRANSCODES_DIR=/data/transcodes

ARIA2_RPC_URL=http://your-aria2-host:6800/jsonrpc
ARIA2_RPC_SECRET=your-aria2-rpc-secret

OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=glm5.1

NEXT_PUBLIC_DEFAULT_LOCALE=zh-Hans
```

Optional metadata sources:

```env
TMDB_API_KEY=your-tmdb-key
OMDB_API_KEY=your-omdb-key
```

Do not use `localhost` for PostgreSQL or aria2 unless they run inside the same container. Inside Docker, `localhost` points to the current container.

Use one of these instead:

```text
postgresql://kura:password@192.168.1.10:5432/kura?schema=public
http://192.168.1.10:6800/jsonrpc
```

Or, if all containers are on the same custom Docker network:

```text
postgresql://kura:password@postgres:5432/kura?schema=public
http://aria2:6800/jsonrpc
```

## kura-web Container

Unraid Docker template:

```text
Name:        kura-web
Repository:  ctudoudou/kura:latest
Network:     bridge or custom Docker network
Web UI:      http://[IP]:[PORT:3000]/zh-Hans
```

Port mapping:

```text
Host port:      3000
Container port: 3000
Protocol:       TCP
```

Volume mapping:

```text
/mnt/user/Kura -> /data
```

Add all environment variables listed above.

## kura-worker Container

Unraid Docker template:

```text
Name:        kura-worker
Repository:  ctudoudou/kura-worker:latest
Network:     same network as kura-web
```

No port mapping is required.

Volume mapping:

```text
/mnt/user/Kura -> /data
```

Add the same environment variables as `kura-web`.

## Database Migration

Run database migration once before starting Kura for the first time, and again after image updates that include schema changes.

From Unraid Terminal:

```bash
docker run --rm \
  -e DATABASE_URL='postgresql://kura:your-password@your-postgres-host:5432/kura?schema=public' \
  ctudoudou/kura-worker:latest \
  npm run prisma:migrate:deploy
```

If your database requires network access through a custom Docker network:

```bash
docker run --rm \
  --network your-docker-network \
  -e DATABASE_URL='postgresql://kura:your-password@postgres:5432/kura?schema=public' \
  ctudoudou/kura-worker:latest \
  npm run prisma:migrate:deploy
```

## Startup Order

1. Start PostgreSQL.
2. Start aria2.
3. Run database migration.
4. Start `kura-web`.
5. Start `kura-worker`.
6. Open:

```text
http://your-unraid-ip:3000/zh-Hans
```

## Initial Checks

After opening Kura:

1. Go to Settings.
2. Check OpenRouter debug.
3. Check aria2 debug.
4. Add an RSS source on the subscriptions page.
5. Run fetch and group.
6. Subscribe to one version.
7. Confirm a download appears in Downloads.
8. After completion, check Organizer.

## Common Issues

### PostgreSQL connection fails

Check that `DATABASE_URL` does not use `localhost`.

Use the Unraid server IP, PostgreSQL container IP, or a Docker network alias.

### aria2 unauthorized

`ARIA2_RPC_SECRET` in Kura must match the aria2 RPC secret exactly.

### Downloads stay waiting

Check the aria2 debug result, aria2 task list, and whether aria2 can access trackers or peers.

### Organizer cannot move files

All configured directories must be inside `DATA_ROOT`.

With the recommended mapping, paths should stay under:

```text
/data
```

### Transcoding is slow

Put `/mnt/user/Kura/transcodes` on SSD/cache storage if possible. HLS preparation writes many small files.

## Update Flow

1. Pull the latest images:

```bash
docker pull ctudoudou/kura:latest
docker pull ctudoudou/kura-worker:latest
```

2. Run migration:

```bash
docker run --rm \
  -e DATABASE_URL='postgresql://kura:your-password@your-postgres-host:5432/kura?schema=public' \
  ctudoudou/kura-worker:latest \
  npm run prisma:migrate:deploy
```

3. Restart `kura-web`.
4. Restart `kura-worker`.

## Backup

Back up:

```text
PostgreSQL database: kura
/mnt/user/Kura
```

At minimum, preserve:

```text
/mnt/user/Kura/library
/mnt/user/Kura/metadata
```
