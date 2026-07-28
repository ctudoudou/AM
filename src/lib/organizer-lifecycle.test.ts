import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pauseAria2Download,
  resumeAria2Download,
  tellKnownDownload,
} from "@/lib/aria2";
import {
  moveOrganizerFiles,
  OrganizerMoveError,
  prepareOrganizerAria2Task,
  restoreOrganizerAria2Task,
  rollbackOrganizerFiles,
} from "./organizer-lifecycle";

vi.mock("node:fs/promises", () => ({
  default: {
    copyFile: vi.fn(),
    link: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    realpath: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock("@/lib/aria2", () => ({
  pauseAria2Download: vi.fn(),
  resumeAria2Download: vi.fn(),
  tellKnownDownload: vi.fn(),
}));

describe("organizer aria2 lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pauseAria2Download).mockResolvedValue("gid-1");
    vi.mocked(resumeAria2Download).mockResolvedValue("gid-1");
  });

  it("pauses active aria2 tasks before moving and can resume them on failure", async () => {
    vi.mocked(tellKnownDownload).mockResolvedValue({ gid: "gid-1", status: "active" });

    const guard = await prepareOrganizerAria2Task("gid-1");
    await expect(restoreOrganizerAria2Task(guard)).resolves.toBe(true);

    expect(pauseAria2Download).toHaveBeenCalledWith("gid-1");
    expect(resumeAria2Download).toHaveBeenCalledWith("gid-1");
  });

  it("does not pause terminal or already paused tasks", async () => {
    vi.mocked(tellKnownDownload).mockResolvedValue({ gid: "gid-1", status: "complete" });

    const guard = await prepareOrganizerAria2Task("gid-1");

    expect(guard).toMatchObject({ previousStatus: "complete", pausedByOrganizer: false });
    expect(pauseAria2Download).not.toHaveBeenCalled();
  });

  it("allows missing historical GIDs but blocks unverifiable aria2 outages", async () => {
    vi.mocked(tellKnownDownload).mockRejectedValueOnce(new Error("aria2 request failed: 400"));
    await expect(prepareOrganizerAria2Task("old-gid")).resolves.toMatchObject({
      previousStatus: "unavailable",
      pausedByOrganizer: false,
    });

    vi.mocked(tellKnownDownload).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(prepareOrganizerAria2Task("gid-1")).rejects.toThrow(
      "Unable to verify aria2 task",
    );
  });
});

describe("organizer move rollback", () => {
  const regularFile = { isFile: () => true, isSymbolicLink: () => false };
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.link).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(fs.realpath).mockImplementation(async (filePath) => String(filePath));
  });

  it("moves every prepared source when all filesystem operations succeed", async () => {
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing);
    const moves = [
      { sourcePath: "/data/downloads/01.mkv", targetPath: "/data/library/01.mkv" },
      { sourcePath: "/data/downloads/02.mkv", targetPath: "/data/library/02.mkv" },
    ];

    await expect(moveOrganizerFiles(moves)).resolves.toEqual(moves);
    expect(fs.link).toHaveBeenCalledTimes(2);
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it("rolls back earlier moves when a later move fails", async () => {
    vi.mocked(fs.link)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("target failure"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce(regularFile as never)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing);
    const moves = [
      { sourcePath: "/data/downloads/01.mkv", targetPath: "/data/library/01.mkv" },
      { sourcePath: "/data/downloads/02.mkv", targetPath: "/data/library/02.mkv" },
    ];

    const error = await moveOrganizerFiles(moves).catch((caught) => caught);

    expect(error).toBeInstanceOf(OrganizerMoveError);
    expect(error.rollback.restored).toEqual([moves[0]]);
    expect(fs.link).toHaveBeenLastCalledWith(moves[0].targetPath, moves[0].sourcePath);
  });

  it("skips rollback when the original source already exists", async () => {
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(regularFile as never)
      .mockResolvedValueOnce(regularFile as never);
    const move = { sourcePath: "/data/downloads/01.mkv", targetPath: "/data/library/01.mkv" };

    await expect(rollbackOrganizerFiles([move])).resolves.toMatchObject({
      restored: [],
      skipped: [move],
      errors: [],
    });
    expect(fs.link).not.toHaveBeenCalled();
  });

  it("never replaces an existing target", async () => {
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(regularFile as never)
      .mockResolvedValueOnce(regularFile as never);
    const move = { sourcePath: "/data/downloads/01.mkv", targetPath: "/data/library/01.mkv" };

    await expect(moveOrganizerFiles([move])).rejects.toThrow("target already exists");
    expect(fs.link).not.toHaveBeenCalled();
    expect(fs.copyFile).not.toHaveBeenCalled();
  });

  it("uses an exclusive verified copy across filesystems", async () => {
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(regularFile as never)
      .mockRejectedValueOnce(missing);
    vi.mocked(fs.link).mockRejectedValueOnce(Object.assign(new Error("cross device"), {
      code: "EXDEV",
    }));
    const move = { sourcePath: "/data/downloads/01.mkv", targetPath: "/data/library/01.mkv" };

    await expect(moveOrganizerFiles([move])).resolves.toEqual([move]);
    expect(fs.copyFile).toHaveBeenCalledWith(
      move.sourcePath,
      move.targetPath,
      expect.any(Number),
    );
    expect(fs.stat).toHaveBeenCalledTimes(2);
    expect(fs.unlink).toHaveBeenCalledWith(move.sourcePath);
  });
});
