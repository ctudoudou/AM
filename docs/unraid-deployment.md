# Kura Unraid Deployment

This guide covers deploying Kura on Unraid when PostgreSQL and aria2 are already deployed separately.

## Containers

Deploy two required long-running Kura containers, optionally deploy the mDNS
advertiser, and run the migrator image when setting up or upgrading the
database:

| Container | Image | Purpose |
| --- | --- | --- |
| `kura-web` | `your-registry/kura:latest` | Web UI and API |
| `kura-worker` | `your-registry/kura-worker:latest` | RSS jobs, download sync, organizer jobs, library scan |
| `kura-migrator` | `your-registry/kura-migrator:latest` | One-shot Prisma database migration |
| `kura-mdns` | `your-registry/kura-mdns:latest` | Optional LAN discovery for `kura.local` |

`kura-web` can open the UI by itself, but background automation requires `kura-worker`.
`kura-mdns` only publishes the LAN name; it does not proxy or serve the web UI.

## Recommended Host Directories

Create these directories on Unraid:

```text
/mnt/user/Kura/downloads
/mnt/user/Kura/import
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
IMPORT_ROOT=/data/import
DOWNLOADS_DIR=/data/downloads
STAGING_DIR=/data/staging
ANIME_LIBRARY_DIR=/data/library/anime
MOVIES_LIBRARY_DIR=/data/library/movies
TV_LIBRARY_DIR=/data/library/tv
METADATA_DIR=/data/metadata
TRANSCODES_DIR=/data/transcodes
FFMPEG_HWACCEL=auto
FFMPEG_VAAPI_DEVICE=/dev/dri/renderD128

ARIA2_RPC_URL=http://your-aria2-host:6800/jsonrpc
ARIA2_RPC_SECRET=change-this-secret

OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=glm5.1

NEXT_PUBLIC_DEFAULT_LOCALE=zh-Hans
```

Optional LAN discovery variables for `kura-mdns`:

```env
KURA_MDNS_HOSTNAME=kura
KURA_MDNS_SERVICE_NAME=Kura
KURA_MDNS_PORT=3000
KURA_MDNS_PATH=/zh-Hans
KURA_MDNS_INTERFACE=
```

Optional metadata sources:

```env
TMDB_API_KEY=your-tmdb-key
OMDB_API_KEY=your-omdb-key
THETVDB_API_KEY=your-thetvdb-key
ANIDB_USERNAME=your-anidb-username
ANIDB_PASSWORD=your-anidb-password
ANIDB_CLIENT_NAME=yourregisteredclient
ANIDB_CLIENT_VERSION=1
```

TheTVDB and AniDB credentials are reserved for season catalog and absolute
episode mapping sync. RSS candidates should not define a season's episode range
by themselves.

Do not use `localhost` for PostgreSQL or aria2 unless they run inside the same container. Inside Docker, `localhost` points to the current container.

Use one of these instead:

```text
postgresql://kura:password@postgres-host:5432/kura?schema=public
http://aria2-host:6800/jsonrpc
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
Repository:  your-registry/kura:latest
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

The slim `kura-web` image does not run database migrations. Run the
`kura-migrator` image before starting or updating `kura-web`.

## kura-mdns Container

Use this optional container when you want devices on the same LAN to resolve
`kura.local`.

Unraid Docker template:

```text
Name:        kura-mdns
Repository:  your-registry/kura-mdns:latest
Network:     host
```

No port mapping or volume mapping is required. Add these environment variables:

```text
KURA_MDNS_HOSTNAME=kura
KURA_MDNS_SERVICE_NAME=Kura
KURA_MDNS_PORT=3000
KURA_MDNS_PATH=/zh-Hans
KURA_MDNS_INTERFACE=
```

With the default `kura-web` port mapping, open:

```text
http://kura.local:3000/zh-Hans
```

For a no-port URL, change `kura-web` to publish host port `80` to container port
`3000`, then set:

```text
KURA_MDNS_PORT=80
```

After that, open:

```text
http://kura.local/zh-Hans
```

Browsers resolve `kura.local` through mDNS, but they do not use the advertised
service port from `_http._tcp` when you type a normal URL.

## kura-worker Container

Unraid Docker template:

```text
Name:        kura-worker
Repository:  your-registry/kura-worker:latest
Network:     same network as kura-web
```

No port mapping is required.

Volume mapping:

```text
/mnt/user/Kura -> /data
```

Add the same environment variables as `kura-web`.

## Database Migration

Run database migration once before starting Kura for the first time, and again
after image updates that include schema changes.

From Unraid Terminal:

```bash
docker run --rm \
  -e DATABASE_URL='postgresql://kura:your-password@your-postgres-host:5432/kura?schema=public' \
  your-registry/kura-migrator:latest
```

If your database requires network access through a custom Docker network:

```bash
docker run --rm \
  --network your-docker-network \
  -e DATABASE_URL='postgresql://kura:your-password@postgres:5432/kura?schema=public' \
  your-registry/kura-migrator:latest
```

## Startup Order

1. Start PostgreSQL.
2. Start aria2.
3. Run `kura-migrator`.
4. Start `kura-web`.
5. Start `kura-worker`.
6. Optional: start `kura-mdns`.
7. Open:

```text
http://your-unraid-ip:3000/zh-Hans
```

If `kura-mdns` is running:

```text
http://kura.local:3000/zh-Hans
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

Kura automatically uses an available VideoToolbox, NVENC, Quick Sync, or
VA-API H.264 backend and falls back to `libx264` if hardware initialization
fails. On Unraid, expose `/dev/dri` to the Kura web container for Intel/AMD
hardware acceleration, or expose an NVIDIA GPU through the NVIDIA runtime.
Verify that the container FFmpeg build lists the expected hardware decoder and
encoder. Set `FFMPEG_HWACCEL=software` to disable hardware acceleration while
diagnosing driver issues.

### kura.local does not resolve

Check that `kura-mdns` uses host networking and that the LAN allows UDP
multicast on port `5353`.

If Unraid or another container already runs Avahi, Bonjour, or another mDNS
responder, it may already own UDP `5353`. Use the existing responder to publish
`kura.local`, or stop the conflicting responder before starting `kura-mdns`.

`.local` only works on the same LAN/VLAN. It is not public DNS and will not
work through normal remote access unless that network carries mDNS traffic.

## Update Flow

1. Pull the latest images:

```bash
docker pull your-registry/kura:latest
docker pull your-registry/kura-worker:latest
docker pull your-registry/kura-migrator:latest
docker pull your-registry/kura-mdns:latest
```

2. Run migration:

```bash
docker run --rm \
  -e DATABASE_URL='postgresql://kura:your-password@your-postgres-host:5432/kura?schema=public' \
  your-registry/kura-migrator:latest
```

3. Restart `kura-web`.
4. Restart `kura-worker`.
5. Optional: restart `kura-mdns`.

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
