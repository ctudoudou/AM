import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATA_ROOT: z.string().default("/data"),
  IMPORT_ROOT: z.string().optional(),
  DOWNLOADS_DIR: z.string().default("/data/downloads"),
  STAGING_DIR: z.string().default("/data/staging"),
  ANIME_LIBRARY_DIR: z.string().default("/data/library/anime"),
  MOVIES_LIBRARY_DIR: z.string().default("/data/library/movies"),
  TV_LIBRARY_DIR: z.string().default("/data/library/tv"),
  METADATA_DIR: z.string().default("/data/metadata"),
  TRANSCODES_DIR: z.string().default("/data/transcodes"),
  VIDEO_RESOLVER_CHROMIUM_PATH: z.string().default(""),
  ARIA2_RPC_URL: z.string().url().default("http://localhost:6800/jsonrpc"),
  ARIA2_RPC_SECRET: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default("glm5.1"),
  TMDB_API_KEY: z.string().default(""),
  OMDB_API_KEY: z.string().default(""),
  THETVDB_API_KEY: z.string().default(""),
  ANIDB_USERNAME: z.string().default(""),
  ANIDB_PASSWORD: z.string().default(""),
  ANIDB_CLIENT_NAME: z.string().default(""),
  ANIDB_CLIENT_VERSION: z.coerce.number().int().positive().default(1),
});

const parsedEnv = envSchema.parse(process.env);

export const serverEnv = {
  ...parsedEnv,
  IMPORT_ROOT:
    parsedEnv.IMPORT_ROOT ||
    path.join(/*turbopackIgnore: true*/ parsedEnv.DATA_ROOT, "import"),
};

export const allowedRoots = [
  serverEnv.DATA_ROOT,
  serverEnv.IMPORT_ROOT,
  serverEnv.DOWNLOADS_DIR,
  serverEnv.STAGING_DIR,
  serverEnv.ANIME_LIBRARY_DIR,
  serverEnv.MOVIES_LIBRARY_DIR,
  serverEnv.TV_LIBRARY_DIR,
  serverEnv.METADATA_DIR,
  serverEnv.TRANSCODES_DIR,
].map((root) => path.resolve(/*turbopackIgnore: true*/ root));

export function assertInsideAllowedRoots(candidatePath: string): string {
  const resolved = path.resolve(/*turbopackIgnore: true*/ candidatePath);
  const isAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );

  if (!isAllowed) {
    throw new Error(`Path is outside configured Kura roots: ${candidatePath}`);
  }

  return resolved;
}
