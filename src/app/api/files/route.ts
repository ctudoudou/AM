import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { getAppSettings } from "@/lib/settings";

const rootSchema = z.enum([
  "dataRoot",
  "importRoot",
  "downloadsDir",
  "animeLibraryDir",
  "moviesLibraryDir",
  "tvLibraryDir",
  "metadataDir",
  "transcodesDir",
]);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rootKey = rootSchema.parse(url.searchParams.get("root") ?? "dataRoot");
    const relativePath = url.searchParams.get("path") ?? "";
    const settings = await getAppSettings();
    const rootPath = path.resolve(settings.directories[rootKey]);
    const currentPath = assertInsideRoot(
      path.join(/*turbopackIgnore: true*/ rootPath, relativePath),
      rootPath,
    );
    const entries = await fs
      .readdir(/* turbopackIgnore: true */ currentPath, { withFileTypes: true })
      .catch((error: unknown) => {
        if (isMissingPathError(error)) {
          return null;
        }
        throw error;
      });
    if (!entries) {
      return jsonResponse({
        root: rootKey,
        rootPath,
        path: relativePath,
        parentPath: null,
        missing: true,
        items: [],
      });
    }
    const items = (
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(currentPath, entry.name);
          const stat = await fs
            .stat(/* turbopackIgnore: true */ fullPath)
            .catch((error: unknown) => {
              if (isMissingPathError(error)) {
                return null;
              }
              throw error;
            });
          if (!stat) {
            return null;
          }
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            sizeBytes: entry.isDirectory() ? null : BigInt(stat.size),
            modifiedAt: stat.mtime,
            extension: entry.isDirectory() ? null : path.extname(entry.name).slice(1),
            relativePath: path.relative(rootPath, fullPath),
          };
        }),
      )
    ).filter((item) => item !== null);

    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return jsonResponse({
      root: rootKey,
      rootPath,
      path: path.relative(rootPath, currentPath),
      parentPath:
        currentPath === rootPath ? null : path.relative(rootPath, path.dirname(currentPath)),
      items,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function isMissingPathError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function assertInsideRoot(candidatePath: string, rootPath: string) {
  const resolved = path.resolve(candidatePath);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Path is outside configured root");
  }
  return resolved;
}
