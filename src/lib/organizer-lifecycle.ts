import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  pauseAria2Download,
  resumeAria2Download,
  tellKnownDownload,
  type Aria2Status,
} from "@/lib/aria2";

export type OrganizerMove = {
  sourcePath: string;
  targetPath: string;
};

export type OrganizerAria2Guard = {
  gid: string;
  previousStatus: Aria2Status["status"] | "unavailable";
  pausedByOrganizer: boolean;
};

export type OrganizerRollbackResult = {
  restored: OrganizerMove[];
  skipped: OrganizerMove[];
  errors: Array<{ move: OrganizerMove; message: string }>;
};

export class OrganizerMoveError extends Error {
  constructor(
    message: string,
    readonly moved: OrganizerMove[],
    readonly rollback: OrganizerRollbackResult,
  ) {
    super(message);
  }
}

export async function prepareOrganizerAria2Task(
  gid: string | null | undefined,
): Promise<OrganizerAria2Guard | null> {
  if (!gid) {
    return null;
  }
  let status: Aria2Status;
  try {
    status = await tellKnownDownload(gid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inspect aria2 task";
    if (aria2TaskIsUnavailable(message)) {
      return { gid, previousStatus: "unavailable", pausedByOrganizer: false };
    }
    throw new Error(`Unable to verify aria2 task ${gid} before organizer move: ${message}`);
  }

  if (status.status === "active" || status.status === "waiting") {
    await pauseAria2Download(gid);
    return { gid, previousStatus: status.status, pausedByOrganizer: true };
  }
  return { gid, previousStatus: status.status, pausedByOrganizer: false };
}

export async function restoreOrganizerAria2Task(guard: OrganizerAria2Guard | null) {
  if (!guard?.pausedByOrganizer) {
    return false;
  }
  await resumeAria2Download(guard.gid);
  return true;
}

export async function moveOrganizerFiles(moves: OrganizerMove[], allowedRoots: string[] = []) {
  const moved: OrganizerMove[] = [];
  try {
    for (const move of moves) {
      await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
      await moveFileNoReplace(move.sourcePath, move.targetPath, allowedRoots);
      moved.push(move);
    }
    return moved;
  } catch (error) {
    const rollback = await rollbackOrganizerFiles(moved, allowedRoots);
    throw new OrganizerMoveError(
      error instanceof Error ? error.message : "Organizer move failed",
      moved,
      rollback,
    );
  }
}

export async function rollbackOrganizerFiles(
  moves: OrganizerMove[],
  allowedRoots: string[] = [],
): Promise<OrganizerRollbackResult> {
  const result: OrganizerRollbackResult = { restored: [], skipped: [], errors: [] };
  for (const move of [...moves].reverse()) {
    try {
      const [sourceExists, targetExists] = await Promise.all([
        regularPathExists(move.sourcePath),
        regularPathExists(move.targetPath),
      ]);
      if (sourceExists || !targetExists) {
        result.skipped.push(move);
        continue;
      }
      await fs.mkdir(path.dirname(move.sourcePath), { recursive: true });
      await moveFileNoReplace(move.targetPath, move.sourcePath, allowedRoots);
      result.restored.push(move);
    } catch (error) {
      result.errors.push({
        move,
        message: error instanceof Error ? error.message : "Organizer rollback failed",
      });
    }
  }
  return result;
}

function aria2TaskIsUnavailable(message: string) {
  return /aria2 request failed:\s*400|not available|not found|unknown gid/i.test(message);
}

async function regularPathExists(filePath: string) {
  const stat = await fs.lstat(filePath).catch(() => null);
  return Boolean(stat && stat.isFile() && !stat.isSymbolicLink());
}

async function moveFileNoReplace(
  sourcePath: string,
  targetPath: string,
  allowedRoots: string[],
) {
  const sourceStat = await fs.lstat(sourcePath);
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw new Error(`Organizer source must be a regular file: ${sourcePath}`);
  }
  const targetStat = await fs.lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (targetStat) {
    throw new Error(`Organizer target already exists: ${targetPath}`);
  }
  await assertRealPathsInsideAllowedRoots(sourcePath, targetPath, allowedRoots);

  let targetCreated = false;
  try {
    try {
      await fs.link(sourcePath, targetPath);
      targetCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
        throw error;
      }
      await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
      targetCreated = true;
      const [sourceAfterCopy, targetAfterCopy] = await Promise.all([
        fs.stat(sourcePath),
        fs.stat(targetPath),
      ]);
      if (sourceAfterCopy.size !== targetAfterCopy.size) {
        throw new Error(`Organizer cross-device copy size mismatch: ${targetPath}`);
      }
    }
    await fs.unlink(sourcePath);
  } catch (error) {
    if (targetCreated && (await regularPathExists(sourcePath))) {
      await fs.unlink(targetPath).catch(() => null);
    }
    throw error;
  }
}

async function assertRealPathsInsideAllowedRoots(
  sourcePath: string,
  targetPath: string,
  allowedRoots: string[],
) {
  if (allowedRoots.length === 0) {
    return;
  }
  const [sourceRealPath, targetParentRealPath, ...rootRealPaths] = await Promise.all([
    fs.realpath(sourcePath),
    fs.realpath(path.dirname(targetPath)),
    ...allowedRoots.map((root) => fs.realpath(root).catch(() => path.resolve(root))),
  ]);
  if (!rootRealPaths.some((root) => isPathInsideRoot(sourceRealPath, root))) {
    throw new Error(`Organizer source real path is outside configured roots: ${sourcePath}`);
  }
  if (!rootRealPaths.some((root) => isPathInsideRoot(targetParentRealPath, root))) {
    throw new Error(`Organizer target real path is outside configured roots: ${targetPath}`);
  }
}

function isPathInsideRoot(candidatePath: string, rootPath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
