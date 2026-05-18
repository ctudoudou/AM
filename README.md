# Kura

[中文版本](README.zh-CN.md)

Kura is an anime-first NAS media application for people who want RSS acquisition,
BT/magnet downloads, metadata repair, file organization, and browser playback in
one self-hosted interface.

It is built around a simple idea: releases arrive from RSS or manual intake,
Kura groups and explains them, you subscribe to the version you want, and the
system helps move completed files into a media-library layout that other NAS
apps can understand.

![Kura anime library](docs/images/kura-anime-library.png)

## What Kura Does

- Builds an anime-first media library with secondary movie and TV sections.
- Reads RSS feeds, groups release candidates, and helps choose subtitle groups,
  quality, codec, and language variants before subscribing.
- Accepts manual magnet links and `.torrent` files for anime, movies, TV, or
  automatic detection.
- Controls aria2 through JSON-RPC for BT/magnet downloads.
- Generates organizer plans before moving files, so risky matches can be
  reviewed instead of silently renamed.
- Uses metadata providers and optional AI assistance to repair titles, aliases,
  episode numbers, covers, and descriptions.
- Stores artwork locally so the library can keep working without repeatedly
  loading covers from external networks.
- Tracks missing episodes and provides historical backfill workflows.
- Streams files in the browser with direct playback, HLS preparation, subtitles,
  and watch progress.
- Supports English, Simplified Chinese, and Traditional Chinese UI locales.

## Product Areas

### Library

The library is the main browsing surface. Anime titles are normalized, grouped
by season and episode, and exposed with cover art, playback actions, progress,
year filters, tags, and repair tools.

### Subscriptions

The subscription page is where RSS sources and manual intake meet. Kura can
fetch feeds, parse candidates, use AI-assisted grouping, and let you subscribe
to the release strategy you actually want instead of downloading every variant.

![RSS and subscription management](docs/images/kura-subscriptions.png)

### Organizer

Completed downloads and imported folders become organizer plans. High-confidence
plans can be automated, while ambiguous or risky plans stay visible for review,
regeneration, rejection, or manual execution.

![Organizer plans](docs/images/kura-organizer.png)

### Downloads

The downloads view mirrors aria2 state, exposes task status, and keeps failed,
waiting, active, completed, and paused items visible for follow-up.

![Download task management](docs/images/kura-downloads.png)

## Why It Exists

Anime releases are messy: titles appear in multiple languages, subtitle groups
encode naming differently, seasonal numbering is inconsistent, and historical
backfill often requires manual judgment. Kura is designed to keep that judgment
inside the product instead of hiding it in scripts, filenames, or one-off
spreadsheets.

The long-term goal is a NAS-native media workflow that remains transparent:
automation should be useful, but every file movement, subscription decision, and
metadata repair should be inspectable.

## Documentation

- [Deployment and local development](docs/deployment.md)
- [Unraid deployment guide](docs/unraid-deployment.md)
- [Historical backfill design](docs/history-backfill-plan.md)
- [Product baseline](docs/kura-product-baseline.md)

## Status

Kura is under active development. The current implementation focuses on anime
RSS workflows, aria2 downloads, organizer automation, local artwork caching, and
browser playback. Movie and TV support exists, but anime remains the primary
design target.
