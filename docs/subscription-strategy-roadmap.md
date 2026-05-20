# Subscription Strategy Roadmap

Kura's next major product improvement should be a stronger subscription strategy
model. The current implementation can subscribe to a grouped release candidate
and remember preferred variant fields, but it does not yet model the user's
intent precisely enough for long-term anime tracking and historical backfill.

## Current Behavior

Subscriptions are currently centered on `Subscription.candidateGroupId`.

When a user subscribes, Kura stores:

- candidate group
- media type
- display title
- preferred subtitle group
- preferred resolution
- preferred codec
- preferred audio
- preferred subtitle language
- preferred release profile
- preferred source kind
- preferred variant key
- fallback policy
- auto-download mode

The matcher then scores future candidates by exact preferred-field matches.

This is useful for a first version, but the user-facing intent is still
underspecified. A subscription should answer more than "which candidate group is
selected"; it should answer "what exactly should Kura download for this title?"

## Problems To Solve

### Coarse Subscribed State

The subscription queue treats a group with any enabled subscription as already
subscribed. This makes the UI too coarse when a title has multiple valid release
strategies, seasons, episode ranges, or variants.

### Missing Season And Episode Intent

Anime subscriptions need explicit season and episode rules:

- follow the latest season
- subscribe to a specific season
- start from episode N
- only download missing episodes
- backfill an episode range
- reject unknown season candidates until confirmed

Without these rules, candidate matching has to infer too much from release
titles.

### Variant Preferences Are Too Strict

Current scoring treats preferred group, resolution, codec, audio, subtitle
language, release profile, and source kind as hard equality checks. That makes
simple cases reliable, but it cannot express ordered preference:

- prefer 1080p, allow 2160p, reject 720p
- prefer CHT, allow CHS
- prefer HEVC, allow AVC
- prefer a subtitle group, fall back to another group

### Batch Releases Need A First-Class Policy

Batch releases and season packs should not be treated the same as single
episodes. A subscription strategy should say whether batches are allowed,
review-only, or rejected.

### Historical Backfill Should Reuse The Same Strategy

Missing episode search and historical anime backfill should not have separate
selection logic. They should reuse the same season, episode range, release
quality, subtitle, and group preferences as ongoing RSS subscriptions.

## Target Model

Introduce a richer strategy layer. This can be a new `SubscriptionRule` model or
an expanded `Subscription` model if the migration remains simple.

Recommended fields:

```text
mediaTitleId
candidateGroupId
mediaType
title
seasonMode              # latest | specific | unknown_review
seasonNumber
episodeMode             # future_only | missing_only | range | all
episodeStart
episodeEnd
preferredGroups         # ordered string array
allowedGroups           # optional allow-list
preferredResolutions    # ordered string array
minimumResolution
maximumResolution
preferredCodecs         # ordered string array
preferredAudio
preferredSubtitleLanguages
preferredReleaseProfiles
preferredSourceKinds
batchPolicy             # reject | review | allow
upgradePolicy           # keep_existing | replace_with_better | manual_review
fallbackPolicy          # strict | manual_review | best_effort
autoDownload
enabled
```

The exact schema can be adjusted, but the important change is that the rule
must represent title, season, episode, variant, and fallback intent explicitly.

## Matching Rules

Candidate matching should become a two-stage process.

### Stage 1: Eligibility

Reject candidates that violate hard constraints:

- wrong media type
- wrong title group
- wrong season when a specific season is configured
- episode outside configured range
- batch rejected by batch policy
- resolution below minimum or above maximum
- group outside allow-list
- subtitle language outside allow-list

### Stage 2: Ranking

Rank eligible candidates with weighted preferences:

- exact preferred variant key
- preferred subtitle group order
- preferred subtitle language order
- preferred resolution order
- codec order
- release profile order
- source kind order
- newer fetch time as final tie-breaker

If the winner is tied, season is unknown, episode is missing, or a batch needs
review, the candidate should be marked for confirmation instead of being
auto-downloaded.

## UI Changes

### Subscribe Dialog

Clicking subscribe should open a strategy dialog instead of silently creating a
subscription. The dialog should summarize:

- title
- season
- episode scope
- selected release group
- quality and codec
- subtitle language
- batch policy
- auto-download mode
- fallback behavior

The confirmation copy should make the result concrete:

```text
Kura will follow Season 02, download missing and future episodes, prefer
1080p CHT releases from Group A, and hold batch releases for review.
```

### Candidate Cards

Candidate cards should show why they match or do not match an active rule:

- matches preferred group
- rejected by resolution
- outside episode range
- batch requires review
- tied with another variant

### Active Subscriptions

The active subscription list should become a strategy list with filters:

- media type
- season
- auto/manual
- batch policy
- needs review
- disabled

Each row should show the rule summary, not only the title and variant fields.

## API Changes

Add or extend endpoints for:

```text
GET    /api/subscriptions
POST   /api/subscriptions
PATCH  /api/subscriptions/:id
DELETE /api/subscriptions/:id
POST   /api/subscriptions/:id/test-match
```

`test-match` should return recent candidates with eligibility and ranking
explanations so the UI can preview what the strategy would download.

## Migration Plan

1. Keep existing subscriptions working.
2. Add nullable strategy fields.
3. Backfill existing subscriptions into equivalent strict rules:
   - `seasonMode = unknown_review`
   - `episodeMode = future_only`
   - single-value preferred arrays from existing preferred fields
   - `batchPolicy = review`
   - existing `fallbackPolicy` preserved
4. Update matcher to read the new fields while supporting old records.
5. Replace the subscribe button with the strategy dialog.
6. Reuse the same rule engine in missing-episode and historical backfill flows.
7. Remove compatibility code after one release cycle.

## First Implementation Slice

The first shippable slice should avoid overbuilding:

1. Add explicit season and episode scope fields.
2. Add batch policy.
3. Change the subscribe action into a confirmation dialog.
4. Fix subscribed-state checks so they compare against the concrete strategy,
   not only the candidate group.
5. Add unit tests for:
   - same title, different season
   - same title, different subtitle group
   - batch release review
   - missing-only episode matching
   - tied variants requiring review

## Success Criteria

Kura should make the result of subscribing obvious:

- users know what will be downloaded
- existing episodes are not duplicated
- season packs do not auto-download unless allowed
- different seasons can coexist under the same title
- missing episode search uses the same preferences as RSS subscriptions
- the queue no longer marks every version as subscribed just because one
  version or group has an active subscription
