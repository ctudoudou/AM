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

## Regeneration safety

Single-plan regeneration verifies that at least one source file still exists, creates and validates
the replacement first, and only then marks the rejected plan resolved. aria2 pseudo-paths beginning
with `[METADATA]` are excluded from Organizer source discovery.
