import { describe, expect, it } from "vitest";
import {
  heuristicGroupHasCorroboratingIdentity,
  proposalNeedsReview,
  reconcileGroupProposals,
  validateGroupProposals,
} from "./candidate-grouper";

const candidates = [{ id: "candidate-1" }, { id: "candidate-2" }, { id: "candidate-3" }];

const proposal = {
  normalizedTitle: "title",
  displayTitle: "Title",
  season: 1,
  confidence: 0.9,
  aliases: ["Title"],
  summary: "Grouped by AI.",
};

describe("validateGroupProposals", () => {
  it("accepts groups that cover every candidate exactly once", () => {
    expect(
      validateGroupProposals(
        [
          { ...proposal, candidateIds: ["candidate-1", "candidate-2"] },
          { ...proposal, normalizedTitle: "other", candidateIds: ["candidate-3"] },
        ],
        candidates,
      ),
    ).toBe(true);
  });

  it("rejects unknown candidate ids returned by the provider", () => {
    expect(
      validateGroupProposals(
        [{ ...proposal, candidateIds: ["candidate-1", "candidate-2", "candidate-x"] }],
        candidates,
      ),
    ).toBe(false);
  });

  it("rejects partial coverage so candidates are not left ungrouped", () => {
    expect(
      validateGroupProposals(
        [{ ...proposal, candidateIds: ["candidate-1", "candidate-2"] }],
        candidates,
      ),
    ).toBe(false);
  });

  it("rejects duplicate candidate ids across groups", () => {
    expect(
      validateGroupProposals(
        [
          { ...proposal, candidateIds: ["candidate-1", "candidate-2"] },
          { ...proposal, normalizedTitle: "other", candidateIds: ["candidate-2", "candidate-3"] },
        ],
        candidates,
      ),
    ).toBe(false);
  });
});

describe("proposalNeedsReview", () => {
  it("does not let high heuristic confidence bypass an explicit review requirement", () => {
    expect(proposalNeedsReview({ confidence: 0.85, reviewRequired: true })).toBe(true);
    expect(proposalNeedsReview({ confidence: 0.9, reviewRequired: false })).toBe(false);
    expect(proposalNeedsReview({ confidence: 0.8, reviewRequired: false })).toBe(true);
  });
});

describe("reconcileGroupProposals", () => {
  const groupableCandidates = [
    {
      id: "candidate-1",
      rawTitle: "[Group A] Example Show - 01 [1080p]",
      parsedTitle: "Example Show",
      normalizedTitle: "example show",
      episodeNumber: 1,
      season: 1,
      resolution: "1080p",
    },
    {
      id: "candidate-2",
      rawTitle: "[Group A] Example Show - 02 [1080p]",
      parsedTitle: "Example Show",
      normalizedTitle: "example show",
      episodeNumber: 2,
      season: 1,
      resolution: "1080p",
    },
    {
      id: "candidate-3",
      rawTitle: "[Group B] Other Show - 01 [1080p]",
      parsedTitle: "Other Show",
      normalizedTitle: "other show",
      episodeNumber: 1,
      season: 1,
      resolution: "1080p",
    },
  ];

  it("keeps safe AI groups and falls back only for uncovered candidates", () => {
    const result = reconcileGroupProposals(
      "ANIME",
      [{ ...proposal, candidateIds: ["candidate-1", "candidate-2"] }],
      groupableCandidates,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      candidateIds: ["candidate-1", "candidate-2"],
      confidence: 0.9,
    });
    expect(result[1]).toMatchObject({
      candidateIds: ["candidate-3"],
      reviewRequired: true,
    });
  });

  it("rejects every overlapping AI group before applying the safe fallback", () => {
    const result = reconcileGroupProposals(
      "ANIME",
      [
        { ...proposal, candidateIds: ["candidate-1", "candidate-2"] },
        { ...proposal, normalizedTitle: "other", candidateIds: ["candidate-2", "candidate-3"] },
      ],
      groupableCandidates,
    );

    expect(result.flatMap((group) => group.candidateIds).sort()).toEqual([
      "candidate-1",
      "candidate-2",
      "candidate-3",
    ]);
    expect(result.every((group) => group.summary.startsWith("Rule grouping"))).toBe(true);
    expect(result.find((group) => group.candidateIds.includes("candidate-3"))).toMatchObject({
      reviewRequired: true,
    });
  });
});

describe("heuristicGroupHasCorroboratingIdentity", () => {
  it("requires distinct releases that share one strong media identity", () => {
    const first = {
      id: "candidate-1",
      rawTitle: "[Group A] Example Show - 01 [1080p]",
      parsedTitle: "Example Show",
      normalizedTitle: "example show",
      episodeNumber: 1,
      season: 1,
      resolution: "1080p",
    };
    const second = {
      ...first,
      id: "candidate-2",
      rawTitle: "[Group B] Example Show - 02 [2160p]",
      episodeNumber: 2,
      resolution: "2160p",
    };

    expect(heuristicGroupHasCorroboratingIdentity("ANIME", [first, second])).toBe(true);
    expect(heuristicGroupHasCorroboratingIdentity("ANIME", [first])).toBe(false);
    expect(
      heuristicGroupHasCorroboratingIdentity("ANIME", [first, { ...second, rawTitle: first.rawTitle }]),
    ).toBe(false);
  });
});
