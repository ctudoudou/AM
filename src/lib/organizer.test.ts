import { describe, expect, it } from "vitest";
import {
  assessOrganizerPlanAutomation,
  isAutoExecutableOrganizerPlan,
  resolveOrganizerItemIdentity,
} from "./organizer";

describe("resolveOrganizerItemIdentity", () => {
  it("uses the actual file episode for downloaded batch releases", () => {
    const identity = resolveOrganizerItemIdentity({
      sourcePath:
        "/data/downloads/[Sakurato][202601] Arisugawa Ren tte Honto wa Onna Nanda yo ne. [01-08 Fin][1080P]/[Sakurato] Arisugawa Ren tte Honto wa Onna Nanda yo ne. [05][AVC-8bit 1080P AAC][CHT].mp4",
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "有栖川炼原来是女孩子啊。 / Arisugawa Ren tte Honto wa Onna Nanda yo ne",
        normalizedTitle: "有栖川炼原来是女孩子啊",
        episodeNumber: null,
        season: null,
        group: {
          displayTitle: "有栖川炼原来是女孩子啊。 / Arisugawa Ren tte Honto wa Onna Nanda yo ne",
          normalizedTitle: "有栖川炼原来是女孩子啊",
          aliases: [
            "Arisugawa Ren tte Honto wa Onna Nanda yo ne",
            "有棲川煉原來是女孩子啊。",
          ],
        },
      },
    });

    expect(identity.season).toBe(1);
    expect(identity.episodeNumber).toBe(5);
    expect(identity.sourceParsedEpisode).toBe(5);
  });

  it("keeps explicit candidate episode identity when present", () => {
    const identity = resolveOrganizerItemIdentity({
      sourcePath: "/data/downloads/Some Anime - 05.mkv",
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "Some Anime",
        normalizedTitle: "some anime",
        episodeNumber: 4,
        season: 2,
        group: {
          displayTitle: "Some Anime",
          normalizedTitle: "some anime",
          aliases: [],
        },
      },
    });

    expect(identity.season).toBe(2);
    expect(identity.episodeNumber).toBe(4);
  });
});

describe("isAutoExecutableOrganizerPlan", () => {
  it("allows only high-confidence pending plans without conflicts", () => {
    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.93,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(true);

    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.89,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(false);
    expect(
      isAutoExecutableOrganizerPlan({
        status: "NEEDS_REVIEW",
        confidence: 0.96,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(false);
    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.96,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: true }],
      }),
    ).toBe(false);
  });
});

describe("assessOrganizerPlanAutomation", () => {
  it("explains why a legacy plan cannot be automatically archived", () => {
    const assessment = assessOrganizerPlanAutomation({
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: false,
      candidate: organizerCandidate(),
      items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
    });

    expect(assessment.executable).toBe(true);
    expect(assessment.autoExecutable).toBe(false);
    expect(assessment.reasons).toContain("Plan was not marked trusted when it was created.");
  });

  it("blocks execution when a source file is known missing", () => {
    const assessment = assessOrganizerPlanAutomation({
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: true,
      candidate: organizerCandidate(),
      items: [
        {
          sourcePath: "/data/downloads/Some Anime - 05.mkv",
          conflict: false,
          sourceExists: false,
        },
      ],
    });

    expect(assessment.executable).toBe(false);
    expect(assessment.autoExecutable).toBe(false);
    expect(assessment.reasons).toContain("One or more source files are missing.");
  });
});

function organizerCandidate() {
  return {
    mediaType: "ANIME" as const,
    parsedTitle: "Some Anime",
    normalizedTitle: "some anime",
    group: {
      displayTitle: "Some Anime",
      normalizedTitle: "some anime",
      aliases: [],
    },
  };
}
