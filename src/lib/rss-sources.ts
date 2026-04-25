import { z } from "zod";

export const rssSourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  enabled: z.boolean().default(true),
});

export const rssSourceUpdateSchema = rssSourceCreateSchema.partial();
