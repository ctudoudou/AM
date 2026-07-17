# Organizer rejected-plan repair

Kura preserves resolved Organizer plans as an audit trail. Migration
`000015_organizer_plan_resolution` adds nullable `resolvedAt` and `resolution` fields so stale or
superseded history can be removed from operational queues without deleting records.

`GET /api/organizer/plans?status=REJECTED` returns unresolved rejected plans by default. Append
`includeResolved=true` when an audit or support workflow needs the complete rejected history.
The same visibility rule applies to resolved orphaned `NEEDS_REVIEW` plans.

## Dry-run and apply

`GET /api/organizer/repair` creates a filesystem-backed repair plan. It groups plans by linked
download and distinguishes:

- stale unlinked history;
- media that already exists at the planned or alias-matched library path;
- sources that can be regenerated;
- completed downloads whose source and archive are both missing;
- downloads that are still active; and
- cases that require review.

The dry-run also includes empty `NEEDS_REVIEW` plans whose download lost its release-candidate
relation. Such a plan is resolved automatically only when Kura can match the download title,
season, episode, and exact byte size to an existing library file. Otherwise it remains a manual
review item; the repair workflow does not retry or delete the source on incomplete evidence.

The response includes a stable plan hash. Apply selected executable actions with:

```json
{
  "planId": "<sha256 plan id>",
  "actionIds": ["<action id>"],
  "confirmation": "I understand this repairs organizer records"
}
```

`POST /api/organizer/repair` regenerates the dry-run before applying changes and returns HTTP 409
if the filesystem or database evidence changed. Resolved history is updated in place; the repair
endpoint does not delete archived Organizer audit records.

## Execution lifecycle

Organizer execution performs a complete path/source/target preflight before changing aria2 or the
filesystem. If the linked aria2 task is active or waiting, Kura pauses it before `MOVE` so a session
restore cannot recreate the source while it is being archived. A missing historical GID is allowed,
while an aria2 outage blocks the move because downloader state cannot be verified.

Every execution creates an `OperationLog` entry. Multi-file moves are tracked as one operation; if a
later move fails, earlier moves are renamed back in reverse order. A task paused by the organizer is
resumed when execution fails. Successful operations keep the task paused and store an `unpause`
rollback hint, preventing post-organizer redownload while preserving a reversible audit trail.

## Regeneration safety

Single-plan regeneration verifies that at least one source file still exists, creates and validates
the replacement first, and only then marks the rejected plan resolved. aria2 pseudo-paths beginning
with `[METADATA]` are excluded from Organizer source discovery.
