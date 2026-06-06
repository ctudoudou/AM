# Kura 历史作品补番设计

## 结论

Kura 现在已经具备“发现缺集、从现有候选或单集 RSS 搜索中选择、交给 aria2 下载、下载完成后生成 organizer plan”的基础链路，但还不是完整的历史补番能力。

当前能力适合单集人工补漏，不适合按作品、季、集范围批量补番。核心缺口是：搜索入口是 `WantedEpisode` 单集粒度；候选库只包含已经抓取过的 RSS item；RSS 搜索只有内置 DMHY 和带 `{query}` 的用户 RSS；候选选择没有作品级批量策略；季/集语义仍用启发式 `season + episodeNumber`，缺少“原始发布编号、绝对编号、季内编号、cour/part 编号”的显式区分。

## 现有链路

### 缺集与候选覆盖

- `scanWantedEpisodes(mediaTitleId)` 读取媒体库里的 `MediaTitle -> Season -> Episode -> MediaFile`，再找所有同作品候选，生成/更新 `WantedEpisode`。
- `buildWantedEpisodeCoverage(...)` 会把文件存在的集标为 `AVAILABLE`，缺失但有候选的标为 `CANDIDATE_FOUND`，有下载/organizer 状态的标为 `DOWNLOADING` 或 `DOWNLOADED`。
- 候选匹配依赖标题别名归一化和候选 season。`candidateMatchesMediaSeason` 基本规则是候选 season 必须存在于媒体库 season 集合中，或者 candidate season 为 1 且媒体库没有 season 1 时排除。
- 覆盖范围的最大集数来自已有 episode、同季 candidate，以及批量标题里的 `01-08` 这种范围。

限制：

- 若历史集从未进入 `RssItem/ReleaseCandidate`，coverage 只能显示 `MISSING`，不会自动主动搜索。
- coverage 是按数据库已有候选推断，不会扫描 provider 历史页，也不会分页。
- 批量包只用于推断 max episode；单集映射仍依赖下载后 organizer 从文件名解析。
- `WantedEpisode` 是 `(mediaTitleId, seasonNumber, episodeNumber)` 唯一，无法记录多个搜索任务、搜索来源、批量候选、失败原因历史。

### RSS 搜索

- `searchWantedEpisodeSources(wantedEpisodeId)` 先查配置 RSS 缓存，再对 provider 搜索 URL 发请求。
- 内置搜索源只有 DMHY：`https://share.dmhy.org/topics/rss/rss.xml?keyword={query}`。
- 用户配置 RSS 只有 URL 包含 `{query}` 或 `{{query}}` 时才作为搜索源。
- 查询由 `buildWantedEpisodeSearchQueries` 生成，形如：`标题 03`、`标题 3`、season > 1 时加 `标题 S05E03`。
- 搜索结果通过 `parseMediaReleaseTitle` 和 `normalizeParsedReleaseEpisode` 打分。强匹配要求 title、episode、season 都匹配。
- UI 只允许下载 strong match；related 只能展示。

限制：

- 入口只能搜单集，不能一次搜 S05E01-E12、缺集列表、或整季。
- 只支持 RSS/XML 搜索，不支持 provider-specific API、HTML 翻页、Mikan bangumi 页面、Nyaa/TokyoTosho 等不同 schema。
- 对 provider 的返回结果没有统一的 seeders、size、date、batch range、可信度模型。
- 选择结果时只校验 normalized episode 是否等于 wanted episode；season 默认使用 wanted season，这会掩盖解析不到 season 的结果。
- 不能把一批搜索结果批量 upsert 成候选后再统一做候选选择。

### 订阅候选

- 常规 RSS 任务是：`fetchAllRssSources -> parseNewRssItems -> groupUngroupedCandidates -> matchSubscriptionsToCandidates`。
- 订阅匹配只处理 subscription 创建之后的新候选：`createdAt > subscription.createdAt`。
- 对同一集按 variant/profile 打分，优先匹配字幕组、分辨率、codec、音轨、字幕语言、source/profile/variant。

限制：

- 订阅系统天然偏“追新”，不补 subscription 创建前已有的历史候选。
- `downloadedEpisodes` 按同组同 episodeNumber 判断，没有 season 进入 key；实际依赖 group 已经按 season 拆开。
- 没有“对某个 mediaTitle 按指定季集范围重跑订阅选择”的接口。

### 下载与归档

- `enqueueCandidateDownload(candidateId)` 支持 magnet、torrent file、torrent URL，创建 `Download` 并把 candidate 状态设为 `SUBSCRIBED`。
- `syncSingleAria2Download` 在下载完成后把 candidate 标为 `DOWNLOADED`，并在还没有有效 organizer plan items 时调用 `createOrganizerPlanForDownload`。
- organizer 会基于 candidate group 匹配元数据，找下载路径下的视频文件，生成目标路径：`Title/Season XX/Title - SxxExx - EpisodeTitle [tags].ext`。
- 自动归档要求元数据可靠、无冲突、有可播放 episode identity、置信度足够高，并且 source path 与 candidate 匹配。

限制：

- 单集候选下载一个批量包时，organizer 可以按文件名解析多集，但 wanted/download 状态仍只关联原本那个 candidate/wanted。
- organizer identity 优先使用 candidate 的 episode；只有 candidate episode 为空时才用 source file episode。这对批量包正确，对“候选解析错集号”的纠错不足。
- 执行 organizer 后没有自动回扫 wanted coverage；需要 scan/页面刷新才能看到缺集变为 available。

## 季和集必须严格建模

历史补番最大的风险不是“搜不到”，而是把错误编号的资源归档到错误集。建议新增一个显式的 Episode Identity 层，不再只依赖 `season + episodeNumber` 两个字段。

### 身份字段

内部计算时至少区分：

- `targetSeason`: Kura 媒体库里的 season number，例如 5。
- `targetEpisode`: Kura 媒体库里的季内 episode number，例如 4。
- `rawSeason`: 从发布标题直接解析出的 season，例如 S05、第五季、Season 5。
- `rawEpisode`: 从发布标题直接解析出的 episode，例如 52。
- `numberingScheme`: `season_relative | absolute_series | cour_relative | part_relative | batch_range | unknown`。
- `episodeOffset`: 绝对编号转季内编号的 offset，例如 S05E52 -> S05E04 时 offset 为 48。
- `evidence`: 命中的规则和证据，例如 `explicit S05 + sibling relative 03/04/05 + absolute 51/52/53`。
- `confidence`: 身份归一化置信度。
- `requiresReview`: 是否禁止自动下载/自动归档。

这些字段可以先不入库，先作为 helper 返回值用于搜索过滤、候选排序和 organizer 目标路径生成。后续如果要审计和 UI 展示，再增加数据库字段或 JSON metadata。

### 规则

1. 明确 season 是硬约束

- 目标是 S05 时，候选必须有明确 S05/第五季/5th Season，或属于已经确认的 S05 group。
- 只有标题完全匹配且没有任何其他 season 信号时，才允许 season 缺省为目标 season，并降级为 manual review。
- 明确 S01/Season 1 的候选不得污染 S05，即使 episode offset 后看起来能对上。

2. raw episode 与 target episode 分开

- `S05E52` 的 `52` 先记录为 rawEpisode。
- 只有在存在足够证据时才能归一成 targetEpisode 4，例如同一 provider/group/title/season 下同时有相对编号 03/04/05 和绝对编号 51/52/53，或有 metadata 确认 S05 从绝对 49 开始。
- 不能因为 episode > 30 就无条件做 12 集窗口归一。

3. cour/part 不是 season

- `第2クール - 13` 应解析为同一个目标 season 内的 cour 2，通常 targetEpisode 1 或 13 取决于媒体库 season 结构，不能直接把 season 变成 2。
- `Part 3 - 30` 同理，Part 是发布分段或官方分部，不等于 Kura Season 3，除非 metadata 明确 Kura 中就是 Season 3。
- offset 规则应以目标 season 的 episode catalog 为准：如果该 season 已有 episode 1-12，则 cour 2 的 13 可映射为 1 或 13 必须由用户选择 policy。对 anime 库建议默认映射到 season 内相对集，但 manual review。

4. batch range 单独处理

- `01-12`、`49-60`、`全集`、`Complete` 要解析成 `batchRange`，不能写成单个 episode。
- 搜索结果若是 batch，应该能覆盖多个 targetEpisode；下载后 organizer 对每个文件重新解析并生成多个 `OrganizerPlanItem`。
- batch 自动选择必须要求所有解析出的文件都在目标 season/range 内，否则 plan needs review。

5. 累计集数需要白名单证据

- 可以接受的证据：
  - 同一 group/source/title/season 内同时出现相对编号和累计编号，支持同一个 offset 至少 2 次。
  - metadata 或用户配置提供 season absolute start，例如 S05 startsAtAbsoluteEpisode=49。
  - 文件名同时含 `S05E52` 和 episode title，与 metadata S05E04 title 匹配。
- 不足证据时，累计编号资源进入 `related` 或 `NEEDS_REVIEW`，不能 strong match、不能自动归档。

## 建议新增能力

### 1. 作品/季/集范围搜索

新增 service：

- `src/lib/history-backfill.ts`
- 输入：
  - `mediaTitleId`
  - `seasonNumber`
  - `episodeStart`
  - `episodeEnd`
  - `providers?: string[]`
  - `includeBatch?: boolean`
  - `dryRun?: boolean`
- 输出：
  - `queryPlan`
  - `resultsByEpisode`
  - `batchResults`
  - `sourceErrors`
  - `unsafeResults`

查询策略：

- 作品级查询：`title`、`title season keyword`、`title 第五季`。
- 单集查询：`title 04`、`title S05E04`、必要时 `title 52` 但只作为 related。
- 范围查询：`title 01-12`、`title 49-60`、`title complete`、`title 全集`。
- 每个 provider 有自己的 query renderer 和 pagination limit。

### 2. Provider 聚合

定义 provider adapter：

```ts
type BackfillProvider = {
  id: string;
  name: string;
  search(input: BackfillProviderQuery): Promise<BackfillProviderResult[]>;
};
```

首批 adapter：

- `configured-rss-cache`: 查本地 `RssItem`。
- `dmhy-rss-search`: 现有内置 DMHY 搜索。
- `configured-rss-search`: 用户配置 `{query}` RSS。

第二批再加：

- `mikan-search`: Mikan 搜索或 bangumi RSS，需要独立 adapter，因为 Mikan 的作品页/订阅页模型和通用 RSS query 不完全一样。
- `nyaa-rss-search` 或其他 RSS 搜索源，按同一 adapter 接口接入。

### 3. 候选选择

新增候选 ranking，不直接复用订阅 matcher：

- 先按 identity 过滤：title、targetSeason、targetEpisode/range。
- 再按 release profile 排序：字幕组、字幕语言、分辨率、codec、source、seeders、发布时间。
- 对安全候选做有限额度的 aria2 临时可用性探测：magnet 优先解析 metadata，torrent URL 做短时低速 probe，探测后清理 aria2 任务；探测结果只作为排序和提示信号，不替代下载完成后的 organizer 安全检查。
- 单集 strong 候选可一键下载。
- 多个 strong 或存在 batch/absolute/cour/part 归一化时，必须进入 review。
- 支持“选中这些 episode 的最佳候选并批量 enqueue”，但每个 episode 要独立记录选择结果。

### 4. 下载后归档联动

下载沿用 `enqueueCandidateDownload` 和现有 `syncAria2Downloads`。

需要增强：

- 对 backfill 创建的 candidate，保存 `backfillTarget` metadata：mediaTitleId、season、episode/range、identity evidence。
- organizer 创建 plan 时优先使用 backfillTarget，但仍要对每个 source file 重新解析，避免错误包污染。
- organizer 执行后触发 `scanWantedEpisodes(mediaTitleId)`，或在 job 中增加 lightweight rescan。
- batch 下载完成后，把同一 plan 中成功归档的多个 episode 都反映到 wanted coverage。

## 最小可实现版本

建议最小版本只做“可用、保守、可回滚”的范围，不做 provider 大扩展和自动批量下载。

### 范围

1. 新增后端 service：`src/lib/history-backfill.ts`

- `searchHistoryBackfill(input)`
- 聚合本地 RSS cache、DMHY、configured RSS search。
- 输入限制为一个 `mediaTitleId + seasonNumber + episodeStart/episodeEnd`。
- 返回候选，不入库或只在用户选择时入库。

2. 新增 identity helper：`src/lib/episode-identity.ts`

- 包装现有 `parseMediaReleaseTitle` 和 `normalizeCandidateEpisodeNumber`。
- 返回显式 `targetSeason/targetEpisode/rawSeason/rawEpisode/numberingScheme/offset/confidence/requiresReview/evidence`。
- 先不替换现有 normalizer，只供 backfill 搜索使用。

3. 新增 API

- `POST /api/library/anime/[id]/history-backfill/search`
  - body: `{ seasonNumber, episodeStart, episodeEnd, providers?, includeBatch? }`
- `POST /api/history-backfill/select-download`
  - body: `{ mediaTitleId, seasonNumber, episodeNumber, resultKey }`
  - MVP 只允许单集 strong 且 `requiresReview=false` 的结果自动下载。

4. UI 最小入口

- 在 anime title 的 missing episodes panel 增加“搜索本季缺集”或“搜索范围”。
- 先展示结果，不默认自动 enqueue。
- related、batch、absolute/cour/part 映射全部显示 review 状态，用户不能直接自动下载，或必须二次确认。

5. Organizer

- MVP 不改 organizer 业务逻辑。
- 只要求选择下载时创建的 candidate 有正确 `season` 和归一后的 `episodeNumber`。
- batch 结果先不自动下载；如果要支持 batch，必须先补 organizer/backfillTarget 验证。

### 测试

新增测试优先级：

1. `src/lib/episode-identity.test.ts`

- `S05E52` 在没有 evidence 时不能 strong 映射到 S05E04。
- 同组有 `S05E03/04/05` 和 `S05E51/52/53` 时，S05E52 可映射到 target episode 4，并记录 offset 48。
- `第2クール - 13` 标为 `cour_relative`，requiresReview 默认 true。
- `Part 3 - 30` 标为 `part_relative`，requiresReview 默认 true。
- `01-12 Fin` 标为 `batch_range`，不返回单集 identity。

2. `src/lib/history-backfill.test.ts`

- 同一搜索结果可覆盖指定 range 中的目标 episode。
- 明确错误 season 的结果被过滤。
- 本地 RSS cache 与 provider 返回去重。
- strong/related/unsafe 排序稳定。

3. 扩展现有测试

- `wanted-rss-search.test.ts`: season > 1 查询应包含 `SxxEyy`，但无 season 的结果不能自动 strong。
- `organizer.test.ts`: backfill 单集 candidate 的 candidate episode 优先；batch 后续版本再测多文件。
- `wanted-episodes.test.ts`: backfill 下载后 candidate 状态能反映到 coverage。

## 风险

- RSS provider 历史搜索不可靠：DMHY/Mikan 的搜索结果可能不完整、排序不稳定、存在限流或反爬。
- 标题别名不足会导致漏搜；别名过宽会导致串番。
- 绝对编号、季内编号、cour/part 的转换没有通用真理，必须让 evidence 和 review 状态可见。
- 批量包最容易污染 organizer：包内可能含 PV、SP、NCOP、字幕文件、不同季文件，MVP 应先禁用自动 batch 下载。
- 当前 schema 没有搜索任务和 identity metadata；MVP 可以无迁移实现，但后续要做可审计批量补番，建议加 `BackfillJob` / `BackfillResult` 或在 `RssItem.raw`、`ReleaseCandidate.releaseTags` 外增加专用 JSON。

## 推荐落地顺序

1. 先做 `episode-identity` helper 和测试，把“不能错集”作为 hard gate。
2. 做 `history-backfill` search-only service，聚合本地 cache + DMHY + configured RSS search。
3. 接 API 和 UI，只允许单集 strong safe 下载。
4. 用户实际跑几部历史番后，再根据误报/漏报补 provider adapter 和别名策略。
5. 最后再做 batch 下载、自动候选选择、自动归档联动。
