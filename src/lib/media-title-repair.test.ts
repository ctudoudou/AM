import { describe, expect, it } from "vitest";
import { createMediaIdentityKeys, type MediaIdentity } from "./media-title-repair";

function mediaIdentity(input: Partial<MediaIdentity>): MediaIdentity {
  return {
    type: input.type ?? "ANIME",
    primaryTitle: input.primaryTitle ?? "",
    originalTitle: input.originalTitle ?? null,
    aliases: input.aliases ?? [],
    metadata: input.metadata ?? [],
    seasons: input.seasons ?? [],
    posterUrl: input.posterUrl,
    year: input.year,
  };
}

describe("createMediaIdentityKeys", () => {
  it("keeps short CJK title keys so localized season titles can merge", () => {
    const metadataBacked = mediaIdentity({
      primaryTitle: "Kanojo, Okarishimasu 5th Season",
      originalTitle: "彼女、お借りします 第5期",
      aliases: [
        { title: "Rent-a-Girlfriend" },
        { title: "出租女友 第五季" },
      ],
    });
    const fileBacked = mediaIdentity({
      primaryTitle: "Rentaru no Koi S05 / 出租女友 第五季",
      aliases: [
        { title: "出租女友 第五季" },
      ],
      seasons: [
        {
          episodes: [
            {
              title: "Rentaru no Koi S05 / 出租女友 第五季",
              files: [
                {
                  originalName: "[ANi] 出租女友 第五季 - 03 [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4",
                  absolutePath:
                    "/data/library/anime/Rentaru no Koi S05 出租女友 第五季/Season 05/Rentaru no Koi S05 出租女友 第五季 - S05E03 - Rentaru no Koi S05 出租女友 第五季 [ANi][1080P][AVC].mp4",
                },
              ],
            },
          ],
        },
      ],
    });

    const metadataKeys = createMediaIdentityKeys(metadataBacked);
    const fileKeys = createMediaIdentityKeys(fileBacked);

    expect(metadataKeys).toContain("出租女友");
    expect(fileKeys).toContain("出租女友");
    expect([...metadataKeys].filter((key) => fileKeys.has(key))).toContain("出租女友");
  });

  it("removes trailing episode and video extension noise from file-derived keys", () => {
    const media = mediaIdentity({
      primaryTitle: "出租女友 第五季",
      aliases: [
        { title: "[ANi] 出租女友 第五季 - 03 [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4" },
      ],
    });

    const keys = createMediaIdentityKeys(media);

    expect(keys).toContain("出租女友");
    expect(keys).not.toContain("出租女友 03 mp4");
  });

  it("collapses TV release variants into the same identity key", () => {
    const edith = mediaIdentity({
      type: "TV",
      primaryTitle: "Scavengers Reign WEB EDITH chs eng",
      seasons: [
        {
          episodes: [
            {
              title: "Scavengers Reign WEB EDITH chs eng [1080p][H264]",
              files: [
                {
                  originalName: "Scavengers Reign WEB EDITH chs eng - S01E12 [1080p][H264].mp4",
                  absolutePath:
                    "/data/library/tv/Scavengers Reign WEB EDITH chs eng/Season 01/Scavengers Reign WEB EDITH chs eng - S01E12 [1080p][H264].mp4",
                },
              ],
            },
          ],
        },
      ],
    });
    const xenon = mediaIdentity({
      type: "TV",
      primaryTitle: "Scavengers Reign XEN0N chs eng",
      seasons: [
        {
          episodes: [
            {
              title: "Scavengers Reign XEN0N chs eng [X264]",
              files: [
                {
                  originalName: "Scavengers Reign XEN0N chs eng - S01E06 [X264].mp4",
                  absolutePath:
                    "/data/library/tv/Scavengers Reign XEN0N chs eng/Season 01/Scavengers Reign XEN0N chs eng - S01E06 [X264].mp4",
                },
              ],
            },
          ],
        },
      ],
    });

    const edithKeys = createMediaIdentityKeys(edith);
    const xenonKeys = createMediaIdentityKeys(xenon);

    expect(edithKeys).toContain("scavengers reign");
    expect(xenonKeys).toContain("scavengers reign");
    expect([...edithKeys].filter((key) => xenonKeys.has(key))).toContain("scavengers reign");
    expect(edithKeys).not.toContain("scavengers reign web edith eng");
    expect(xenonKeys).not.toContain("scavengers reign xen0n eng");
  });
});
