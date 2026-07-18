import { describe, expect, it } from "vitest";
import { agedmPlugin } from "./agedm";

const detailHtml = `
<!doctype html>
<html>
  <head>
    <title>测试动画 - AGE动漫</title>
    <meta property="og:title" content="测试动画 - AGE动漫" />
    <meta property="og:image" content="https://cdn.example.test/poster.jpg" />
    <meta name="description" content="测试简介" />
  </head>
  <body>
    <a href="https://www.agedm.io/play/20250111/1/1">测试动画</a>
    <a href="/play/20250111/1/1">第01集</a>
    <a href="/play/20250111/1/2">第02集</a>
    <a href="/play/20250111/2/1">第01集</a>
    <a href="/play/20250111/2/2">第02集</a>
  </body>
</html>`;

describe("AGE video source plugin", () => {
  it("groups mirror lines as sources instead of duplicate episodes", async () => {
    const result = await agedmPlugin.inspect(new URL("https://www.agedm.io/detail/20250111"), {
      fetchHtml: async () => detailHtml,
    });

    expect(result).toMatchObject({
      provider: "agedm",
      sourceItemId: "20250111",
      title: "测试动画",
      kind: "detail",
      posterUrl: "https://cdn.example.test/poster.jpg",
    });
    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[0]).toMatchObject({ key: "episode:1", number: 1 });
    expect(result.episodes[0].sources).toEqual([
      expect.objectContaining({ id: "line:1", sourceIndex: 1 }),
      expect.objectContaining({ id: "line:2", sourceIndex: 2 }),
    ]);
  });

  it("limits play URLs to one episode and prioritizes the requested line", async () => {
    const result = await agedmPlugin.inspect(
      new URL("https://www.agedm.io/play/20250111/2/1"),
      { fetchHtml: async () => detailHtml },
    );

    expect(result.kind).toBe("play");
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].sources.map((source) => source.id)).toEqual([
      "line:2",
      "line:1",
    ]);
  });

  it("rejects lookalike domains and unsupported paths", () => {
    expect(agedmPlugin.canHandle(new URL("https://www.agedm.io/detail/20250111"))).toBe(true);
    expect(agedmPlugin.canHandle(new URL("https://agedm.io.evil.test/detail/20250111"))).toBe(
      false,
    );
    expect(agedmPlugin.canHandle(new URL("https://www.agedm.io/search?q=test"))).toBe(false);
  });
});
