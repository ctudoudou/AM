import { describe, expect, it } from "vitest";
import {
  classifyAria2ProbeStatus,
  indexAvailability,
} from "./torrent-availability";

describe("torrent availability", () => {
  it("treats aria2 peer connections as available", () => {
    expect(
      classifyAria2ProbeStatus(
        {
          gid: "probe",
          status: "active",
          connections: "2",
          numSeeders: "1",
          infoHash: "abc123",
        },
        { checkedAt: "2026-06-06T00:00:00.000Z", isMagnetProbe: false, seeders: null },
      ),
    ).toMatchObject({
      status: "available",
      source: "aria2",
      connections: 2,
      seeders: 1,
      metadataResolved: true,
    });
  });

  it("treats resolved magnet metadata as available even before speed appears", () => {
    expect(
      classifyAria2ProbeStatus(
        {
          gid: "probe",
          status: "active",
          infoHash: "abc123",
          bittorrent: { info: { name: "Episode 03" } },
          downloadSpeed: "0",
        },
        { checkedAt: "2026-06-06T00:00:00.000Z", isMagnetProbe: true, seeders: null },
      ),
    ).toMatchObject({
      status: "available",
      metadataResolved: true,
    });
  });

  it("keeps index seeders as reported instead of confirmed availability", () => {
    expect(indexAvailability({ seeders: 12 })).toMatchObject({
      status: "reported",
      source: "index",
      seeders: 12,
      metadataResolved: false,
    });
    expect(indexAvailability({ seeders: null })).toMatchObject({
      status: "unknown",
      source: "index",
    });
  });
});
