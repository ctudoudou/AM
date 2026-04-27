import { describe, expect, it } from "vitest";
import { validateGroupProposals } from "./candidate-grouper";

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
