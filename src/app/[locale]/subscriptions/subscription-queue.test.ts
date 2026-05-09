import { describe, expect, it } from "vitest";
import {
  sortCandidateGroupsForQueue,
  summarizeCandidateGroupFreshness,
  type QueueCandidateGroup,
} from "./subscription-queue";

const baseGroup = {
  confidence: 0.8,
  reviewRequired: false,
  candidates: [],
};

describe("subscription queue helpers", () => {
  it("sorts latest candidates ahead of older groups", () => {
    const groups: QueueCandidateGroup[] = [
      {
        ...baseGroup,
        id: "older",
        candidates: [{ createdAt: "2026-04-20T00:00:00.000Z" }],
      },
      {
        ...baseGroup,
        id: "newer",
        candidates: [{ createdAt: "2026-04-21T00:00:00.000Z" }],
      },
    ];

    expect(sortCandidateGroupsForQueue(groups, "LATEST", new Set()).map((group) => group.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("can prioritize unsubscribed groups before subscribed groups", () => {
    const groups: QueueCandidateGroup[] = [
      {
        ...baseGroup,
        id: "subscribed-newer",
        candidates: [{ createdAt: "2026-04-22T00:00:00.000Z" }],
      },
      {
        ...baseGroup,
        id: "unsubscribed-older",
        candidates: [{ createdAt: "2026-04-20T00:00:00.000Z" }],
      },
    ];

    expect(
      sortCandidateGroupsForQueue(groups, "UNSUBSCRIBED", new Set(["subscribed-newer"])).map(
        (group) => group.id,
      ),
    ).toEqual(["unsubscribed-older", "subscribed-newer"]);
  });

  it("summarizes the newest candidate source for a group", () => {
    const summary = summarizeCandidateGroupFreshness({
      ...baseGroup,
      id: "group",
      candidates: [
        { createdAt: "2026-04-20T00:00:00.000Z", sourceKind: "Baha" },
        { createdAt: "2026-04-22T00:00:00.000Z", sourceKind: "WEB" },
      ],
    });

    expect(summary).toEqual({
      createdAt: "2026-04-22T00:00:00.000Z",
      sourceKind: "WEB",
    });
  });
});
