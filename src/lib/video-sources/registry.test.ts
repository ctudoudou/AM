import { describe, expect, it } from "vitest";
import { buildVideoSourcePlanId } from "./registry";
import type { VideoSourceInspectionDraft } from "./types";

const inspection: VideoSourceInspectionDraft = {
  provider: "agedm",
  providerName: "AGE动漫",
  sourceItemId: "20250111",
  sourceUrl: "https://www.agedm.io/detail/20250111",
  canonicalUrl: "https://www.agedm.io/detail/20250111",
  kind: "detail",
  title: "测试动画",
  description: null,
  posterUrl: null,
  seasonNumber: 1,
  episodes: [
    {
      key: "episode:1",
      number: 1,
      label: "第01集",
      sources: [
        {
          id: "line:1",
          label: "线路 1",
          playUrl: "https://www.agedm.io/play/20250111/1/1",
          sourceIndex: 1,
        },
      ],
    },
  ],
};

describe("video source plan", () => {
  it("is stable for the same source inventory and changes with a play URL", () => {
    expect(buildVideoSourcePlanId(inspection)).toBe(buildVideoSourcePlanId({ ...inspection }));
    expect(buildVideoSourcePlanId(inspection)).not.toBe(
      buildVideoSourcePlanId({
        ...inspection,
        episodes: [
          {
            ...inspection.episodes[0],
            sources: [
              {
                ...inspection.episodes[0].sources[0],
                playUrl: "https://www.agedm.io/play/20250111/2/1",
              },
            ],
          },
        ],
      }),
    );
  });
});
