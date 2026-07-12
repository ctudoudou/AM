# Download repair operations

Kura repairs download history through a dry-run-first API that reconciles PostgreSQL records,
aria2 tasks, and files under `DOWNLOADS_DIR`.

## Safety model

- `GET /api/downloads/repair` is read-only. It returns a stable `planId`, repair actions, confidence,
  path and control-file evidence, dependencies, and manual-review items.
- File checks reject paths outside `DOWNLOADS_DIR` and symbolic-link targets.
- A file is only considered complete when its byte length is known and the on-disk file is at least
  that length. Unknown-length and partial files are never marked complete automatically.
- `POST /api/downloads/repair` requires the current `planId`, explicit `actionIds`, and the exact
  confirmation phrase `I understand this repairs download records`.
- If aria2 or disk state changes after the dry-run, the plan hash changes and execution returns HTTP
  `409` until a new dry-run is reviewed.
- Duplicate rows are not deleted. They retain `supersededById` and `repairNote` audit fields, while
  linked organizer plans move to the canonical download.
- `GET /api/downloads` hides superseded rows by default. Audit callers can request
  `?includeSuperseded=true`.

## Repair actions

| Action | Behavior |
| --- | --- |
| `sync_existing_gid` | Synchronize a database record whose current GID still exists in aria2. |
| `adopt_aria2_gid` | Adopt the only aria2 task matching the persisted info hash or target path. |
| `mark_completed` | Complete a record only after the expected target length is present on disk. |
| `retry_source` | Re-add the original source; existing `.aria2` data or BT piece hashes may resume it. |
| `supersede_duplicate` | Point a duplicate record at a healthy canonical record without deleting history. |
| `manual_review` | Report ambiguity or unsafe evidence without offering automatic execution. |

When a duplicate depends on repairing its canonical record, both action IDs must be selected in the
same execution. The duplicate is skipped if the canonical action fails.

## Database compatibility

Migration `000014_download_repair_identity` adds nullable `infoHash`, `supersededById`, and
`repairNote` columns plus indexes and a self-referencing foreign key. The migration is additive, so
the previous application version can continue reading existing download rows during a rolling
deployment. The new application version requires the migration before serving the repair API.

The normal `migrate` service or `npm run prisma:migrate:deploy` applies the migration. Back up the
PostgreSQL database and the persistent aria2 `/config` volume before applying repair actions.

## aria2 restart protection

Before intentionally restarting aria2, call `aria2.saveSession` and ensure `input-file`,
`save-session`, `save-session-interval`, and `auto-save-interval` point into the persistent `/config`
volume. Enabling `bt-save-metadata` and `bt-load-saved-metadata` also lets magnet jobs reuse saved
`.torrent` metadata after a restart.
