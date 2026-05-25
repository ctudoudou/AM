import { describe, expect, it } from "vitest";
import { detectCandidateReplayIssue, isSuspiciousTitleToken } from "./data-health";

describe("data health helpers", () => {
  it("flags parser replay drift for release edition titles stored as media titles", () => {
    const issue = detectCandidateReplayIssue({
      id: "candidate-1",
      groupId: "group-1",
      mediaType: "ANIME",
      rawTitle:
        "[黒ネズミたち] 淫獄團地 [年齡限制版] / Ingoku Danchi - 07 (Baha 1920x1080 AVC AAC MP4)",
      parsedTitle: "年齡限制版",
      normalizedTitle: "年龄限制版",
      episodeNumber: 7,
      season: null,
      group: {
        id: "group-1",
        displayTitle: "年龄限制版",
        normalizedTitle: "年龄限制版",
        aliases: [],
      },
    });

    expect(issue?.newParsedTitle).toBe("淫獄團地 / Ingoku Danchi");
    expect(issue?.newNormalizedTitle).toBe("淫狱团地");
  });

  it("does not flag stable candidate identity", () => {
    const issue = detectCandidateReplayIssue({
      id: "candidate-1",
      groupId: "group-1",
      mediaType: "ANIME",
      rawTitle: "[Group] Some Anime - 03 [1080p][AVC AAC]",
      parsedTitle: "Some Anime",
      normalizedTitle: "some anime",
      episodeNumber: 3,
      season: null,
      group: {
        id: "group-1",
        displayTitle: "Some Anime",
        normalizedTitle: "some anime",
        aliases: [],
      },
    });

    expect(issue).toBeNull();
  });

  it("recognizes non-title pollution tokens", () => {
    expect(isSuspiciousTitleToken("简／繁")).toBe(true);
    expect(isSuspiciousTitleToken("1080p")).toBe(true);
    expect(isSuspiciousTitleToken("Some Anime")).toBe(false);
  });
});
