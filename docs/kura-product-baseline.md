# Kura Product Baseline

## Product Positioning

Kura is an anime-first NAS media application with secondary support for movies,
TV, music, photos, and general files. It combines media library management,
RSS-driven acquisition, aria2 download orchestration, metadata aggregation,
AI-assisted title matching, online playback, watch progress tracking, and safe
NAS directory organization.

The product should feel like a modern NAS media console, not a marketing site or
a generic streaming clone. The interface should be dense, calm, image-led, and
operationally clear.

## Confirmed Name

- Product name: Kura
- Repository/package naming: `kura`
- Internal namespace prefix: `KURA_`

## Local Data Layout

Application code should treat the media root as configurable. Docker should map
the host NAS path to a stable container path.

Default container layout:

```txt
/data
  /downloads
  /staging
  /library
    /anime
    /movies
    /tv
  /metadata
  /transcodes
```

Recommended environment variables:

```env
DATA_ROOT=/data
DOWNLOADS_DIR=/data/downloads
STAGING_DIR=/data/staging
ANIME_LIBRARY_DIR=/data/library/anime
MOVIES_LIBRARY_DIR=/data/library/movies
TV_LIBRARY_DIR=/data/library/tv
METADATA_DIR=/data/metadata
TRANSCODES_DIR=/data/transcodes
```

Docker mapping:

```yaml
volumes:
  - ${KURA_DATA_ROOT:-./data}:/data
```

All file operations must validate that source and target paths stay inside
configured allowed roots. The organizer must be dry-run first.

## Technology Baseline

- Framework: Next.js 16 stable, App Router, TypeScript
- Database: PostgreSQL
- Local environment: Docker Compose
- Downloader: aria2 JSON-RPC for initial BT/magnet support
- Worker: separate Node.js process for RSS, metadata, AI matching, downloads,
  directory scanning, and organizer jobs
- Job queue: Postgres-backed queue preferred initially
- Internationalization: built in from the first implementation phase

## Figma References

Primary visual references:

- Home/media center: `https://www.figma.com/design/EGXsHOcIeFDG1x0crSQTbY/NAS?node-id=2-2`
- Media grid/list page: `https://www.figma.com/design/EGXsHOcIeFDG1x0crSQTbY/NAS?node-id=2-537`
- File browser: `https://www.figma.com/design/EGXsHOcIeFDG1x0crSQTbY/NAS?node-id=2-895`

These references are design constraints. Implementation should follow their
layout density, dark surface treatment, radius scale, typography hierarchy,
sidebar structure, media card behavior, and file-list language.

## Visual System

Visual thesis:

Kura should feel like a precise, modern dark NAS console where anime artwork
carries the atmosphere and the controls stay restrained.

Base colors:

```css
--background: #000000;
--surface-1: rgba(255, 255, 255, 0.03);
--surface-2: rgba(255, 255, 255, 0.05);
--surface-3: rgba(255, 255, 255, 0.08);
--surface-active: rgba(255, 255, 255, 0.10);
--border-subtle: rgba(255, 255, 255, 0.05);
--border-default: rgba(255, 255, 255, 0.08);
--border-strong: rgba(255, 255, 255, 0.12);
--text-primary: rgba(255, 255, 255, 1);
--text-secondary: rgba(255, 255, 255, 0.65);
--text-muted: rgba(255, 255, 255, 0.40);
--text-faint: rgba(255, 255, 255, 0.25);
--accent-success: #00d492;
--accent-rating: #fdc700;
```

Layout:

- Fixed desktop sidebar width: `256px`
- Main content padding: `32px`
- Sidebar item horizontal inset: `12px`
- Sidebar search inset: `16px`
- Compact control height: `38px`
- Primary nav item height: `40px` to `42px`
- Media poster card width baseline: `144px` for home rows, `182px` for library
  grid
- Poster aspect ratio: roughly `2 / 3`

Radius:

- Sidebar logo/control: `14px`
- Nav item: `14px`
- Search/filter button: `10px` to `14px`
- Poster image: `14px`
- Panels: `16px`
- Small tags: `4px` to `8px`

Typography:

- Font stack: `Inter`, `Noto Sans SC`, `Noto Sans JP`, system sans-serif
- Page title: `25.6px / 38.4px`, bold
- Section title: `16px / 24px`, bold
- Nav text: `14px / 20px`
- Body metadata: `12px / 16px`
- Letter spacing should default to `0` for multilingual stability.

Component language:

- Use real icons from the chosen icon library where possible.
- Avoid decorative cards. Use panels only for actual data containers, repeated
  media items, file tables, modals, and tool surfaces.
- Media cards use image, dark gradient overlays, compact badges, rating, and
  progress indicators.
- Tables use faint borders and row height around `60px`.
- Controls are compact and low-contrast unless active.

## Navigation Model

Initial sidebar:

```txt
Kura
Search

Library
- Home
- Anime
- Movies
- TV

Automation
- Subscriptions
- Downloads
- Organizer

System
- Files
- Settings
```

The Figma sidebar category language should be preserved, but Kura should expose
anime automation features as first-class workflows.

## First Screens

Home:

- Hero/backdrop area for continue watching or featured anime
- Continue watching row
- Recently fetched row
- Subscription updates
- Download status summary
- Storage overview

Anime library:

- Title and count summary
- Search input
- Sort dropdown
- View toggle
- Filter chips for status, season, resolution, subtitle group, source, watched
- Poster grid with progress, rating, year/season, episode status, and quality

Downloads:

- Active, waiting, completed, and failed tabs
- aria2 status summary
- Per-task speed, progress, peers, ETA, size, target path, source RSS item

Subscriptions:

- Anime subscriptions with feed source, preferred subtitle group, quality,
  frequency, auto-download policy, and matching confidence behavior

Organizer:

- Scan source selector
- Dry-run plan table
- Current path, parsed identity, metadata match, confidence, target path,
  conflict status, action
- Confirmed execution only after preview
- Operation log and rollback metadata

Files:

- Follow the Figma file browser closely
- Disk overview
- Breadcrumb path
- Search/sort/view controls
- Table rows with name, size, modified date, type, and item count

Settings:

- RSS source presets and custom feed management
- OpenRouter API key and model settings
- Fetch/subscription frequency
- Directory roots
- aria2 RPC endpoint and secret
- Metadata providers and priority
- Language and locale

## AI Matching Principles

Deterministic parsing runs before AI. AI is only used for ambiguous grouping,
title equivalence, and variant presentation.

AI output must be strict JSON with confidence scores. Low-confidence results are
never auto-applied; they enter review queues.

Matching should preserve:

- Raw title
- Normalized title
- Subtitle group
- Episode number
- Season/cour
- Resolution
- Codec
- Audio
- Subtitle language
- Source feed
- Magnet/torrent identity
- AI confidence and explanation summary

## Organizer Safety

The organizer must never silently mutate NAS data. Required flow:

1. Scan
2. Parse
3. Match metadata
4. Generate dry-run plan
5. Surface conflicts and low-confidence rows
6. User confirms
7. Execute move/copy/hardlink
8. Record operation log
9. Allow rollback where possible

Recommended anime target naming:

```txt
Anime Title (Year)/Season 01/Anime Title - S01E03 - Episode Title [Group][1080p][x265][AAC].mkv
```

Store sidecar metadata for compatibility with Jellyfin, Plex, Kodi, and other
media managers where practical.

## Test Baseline

Core test areas:

- RSS parsing
- Anime filename parsing
- Title normalization
- AI matching JSON schema validation
- Subscription candidate grouping
- aria2 RPC client behavior with mocks
- Directory root safety checks
- Organizer dry-run planning
- Path conflict handling
- Playback progress persistence
- API route validation
- Playwright coverage for major workflows

The first implementation phase should include tests for parsers, path safety,
and organizer planning before UI polish work expands.
