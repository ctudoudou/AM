import { describe, expect, it } from "vitest";
import { auditAnimeTitleRecord } from "./library-audit";

describe("auditAnimeTitleRecord", () => {
  it("does not flag matching library and episode titles", () => {
    const issues = auditAnimeTitleRecord({
      id: "iruma",
      primaryTitle: "入间同学入魔了 第四季 / Mairimashita! Iruma-kun",
      posterUrl: "https://example.test/poster.jpg",
      seasons: [
        {
          episodes: [
            {
              title: "入间同学入魔了 第四季 / Mairimashita! Iruma-kun",
              files: [{ originalName: "iruma.mkv", absolutePath: "/library/iruma.mkv" }],
            },
          ],
        },
      ],
    });

    expect(issues).toEqual([]);
  });

  it("flags a title that was attached to unrelated episode files", () => {
    const issues = auditAnimeTitleRecord({
      id: "bad-match",
      primaryTitle: "Dealing with Mikadono Sisters Is a Breeze",
      posterUrl: "https://example.test/poster.jpg",
      seasons: [
        {
          episodes: [
            {
              title: "迦楠大人的白给是恶魔级 / Kanan-sama wa Akumade Choroi",
              files: [
                {
                  originalName: "[ANi] Kanan-sama wa Akumade Choroi - 03.mkv",
                  absolutePath: "/library/Kanan-sama wa Akumade Choroi/Season 01/episode.mkv",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(issues).toMatchObject([
      {
        mediaId: "bad-match",
        issue: "TITLE_EPISODE_MISMATCH",
        severity: "HIGH",
        suggestedTitle: "迦楠大人的白给是恶魔级 / Kanan-sama wa Akumade Choroi",
      },
    ]);
  });
});
