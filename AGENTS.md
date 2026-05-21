# AGENTS.md

Project instructions for Codex and other coding agents. Scope: the whole repository.

The complete human-facing development charter is in `docs/development-charter.zh-CN.md`. Keep this file short, current, and aligned with `CLAUDE.md`.

## Project

Kura is an anime-first NAS media automation app built with Next.js App Router, TypeScript, Prisma/PostgreSQL, aria2 JSON-RPC, and a separate Node worker.

The product goal is a transparent, inspectable workflow for RSS intake, downloads, organizer plans, metadata repair, local artwork caching, and browser playback.

## Key Commands

```bash
npm run dev
npm run worker
npm run lint
npm run test
npm run build
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
```

Local default URL:

```text
http://localhost:3000/zh-Hans
```

## Required Workflow

- Start by checking `git status --short`; never overwrite unrelated user changes.
- Read the nearby implementation, tests, and docs before editing.
- Keep changes scoped to the requested task.
- Prefer existing project helpers and patterns over new abstractions.
- Use `rg` for code search.
- Use `apply_patch` for manual edits.
- Do not commit unless the user explicitly asks.

## Product And Domain Rules

- Follow `docs/kura-product-baseline.md` for product positioning, visual style, and domain constraints.
- Treat anime title, season, episode, subtitle group, quality, codec, language, and release variant as domain data, not loose filename text.
- Organizer and file operations must be dry-run first where applicable and must stay inside configured allowed roots.
- AI-assisted decisions must not bypass safety gates; low-confidence or high-risk results must require review.
- Worker jobs should be idempotent and safe to rerun.

## Security Rules

- Never commit `.env`, real API keys, aria2 secrets, NAS hostnames, NAS IPs, private registry names, downloaded media, local databases, or generated runtime noise.
- Validate API inputs, external RSS data, aria2 responses, AI responses, environment variables, and file paths at trust boundaries.
- Database schema changes require a Prisma migration and a compatibility note.

## Testing Rules

- For behavior changes, add or update tests near the changed code.
- Parser, matcher, organizer, download, subtitle, metadata, subscription, queue, API, environment, and path-safety changes require targeted tests.
- Bug fixes should include a regression test for the failing case.
- Before handoff, run `npm run lint` and `npm run test` when relevant.
- Run `npm run build` for Next.js pages, API routes, Prisma, Docker/runtime config, or packaging changes.
- If a check cannot run, report the reason and residual risk.

## UI Rules

- Keep the UI a dense, calm, modern dark NAS console.
- Avoid marketing-page patterns for app surfaces.
- Keep controls compact and operational.
- Use existing icons and components where possible.
- Check multilingual text fit for English, Simplified Chinese, and Traditional Chinese when editing user-facing copy.

## Git And Handoff

- Use English Conventional Commits when asked to commit, for example `feat: add subscription review queue` or `fix: reject organizer paths outside data root`.
- Before staging or committing, review `git diff --stat`, `git diff`, and `git status --short`.
- Summaries should include changed files, verification commands, and any skipped checks.
