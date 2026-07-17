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

export async function moveOrganizerFiles(moves: OrganizerMove[]) {
  const moved: OrganizerMove[] = [];
  try {
    for (const move of moves) {
      await fs.mkdir(path.dirname(move.targetPath), { recursive: true });
      await fs.rename(move.sourcePath, move.targetPath);
      moved.push(move);
    }
    return moved;
  } catch (error) {
    const rollback = await rollbackOrganizerFiles(moved);
    throw new OrganizerMoveError(
      error instanceof Error ? error.message : "Organizer move failed",
      moved,
      rollback,
    );
  }
}

export async function rollbackOrganizerFiles(
  moves: OrganizerMove[],
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
      await fs.rename(move.targetPath, move.sourcePath);
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
  return Boolean(stat && !stat.isSymbolicLink());
}
