import { z } from "zod";
import { getAppSettings } from "@/lib/settings";

const aiGroupSchema = z.object({
  groups: z.array(
    z.object({
      normalizedTitle: z.string().min(1),
      displayTitle: z.string().min(1),
      season: z.number().int().nullable().optional(),
      candidateIds: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1),
      aliases: z.array(z.string()).default([]),
      summary: z.string().default(""),
    }),
  ),
});

const organizerReviewSchema = z.object({
  riskLevel: z.enum(["OK", "REVIEW", "REJECT"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().default(""),
  acceptedSourcePaths: z.array(z.string()).default([]),
  rejectedSourcePaths: z.array(z.string()).default([]),
});

export type AiCandidateInput = {
  id: string;
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  episodeNumber?: number | null;
  season?: number | null;
  subtitleGroup?: string | null;
  resolution?: string | null;
  codec?: string | null;
};

export type OrganizerReviewInput = {
  planId: string;
  mediaType: string;
  candidateTitle: string;
  candidateAliases: string[];
  episodeNumber?: number | null;
  season?: number | null;
  targetTitle?: string | null;
  items: Array<{
    sourcePath: string;
    targetPath: string;
    parsedTitle?: string;
    parsedEpisodeNumber?: number | null;
    parsedSeason?: number | null;
  }>;
};

export type OrganizerAiReview = z.infer<typeof organizerReviewSchema>;

export async function groupCandidatesWithOpenRouter(candidates: AiCandidateInput[]) {
  const settings = await getAppSettings();

  if (!settings.ai.openRouterApiKey) {
    return heuristicGroups(candidates);
  }

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${settings.ai.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Kura",
      },
      body: JSON.stringify({
        model: settings.ai.model || "glm5.1",
        messages: [
          {
            role: "system",
            content:
              "You group anime release candidates. Return strict JSON only, with no markdown: {\"groups\":[{\"normalizedTitle\":\"\",\"displayTitle\":\"\",\"season\":1,\"candidateIds\":[\"\"],\"confidence\":0.9,\"aliases\":[],\"summary\":\"\"}]}",
          },
          {
            role: "user",
            content: JSON.stringify({ candidates }),
          },
        ],
      }),
    });
  } catch {
    return heuristicGroups(
      candidates,
      "Heuristic grouping used because OpenRouter did not respond before the timeout.",
    );
  }

  if (!response.ok) {
    return heuristicGroups(
      candidates,
      `Heuristic grouping used because OpenRouter returned ${response.status}.`,
    );
  }

  try {
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const json = typeof content === "string" ? JSON.parse(content) : content;
    return aiGroupSchema.parse(json).groups;
  } catch {
    return heuristicGroups(
      candidates,
      "Heuristic grouping used because OpenRouter returned an invalid grouping response.",
    );
  }
}

export async function reviewOrganizerPlanWithOpenRouter(
  input: OrganizerReviewInput,
): Promise<OrganizerAiReview | null> {
  const settings = await getAppSettings();

  if (!settings.ai.openRouterApiKey) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${settings.ai.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Kura",
      },
      body: JSON.stringify({
        model: settings.ai.model || "glm5.1",
        messages: [
          {
            role: "system",
            content:
              "You review NAS anime organizer plans. Decide which source files belong to the candidate title and episode. Return strict JSON only: {\"riskLevel\":\"OK|REVIEW|REJECT\",\"confidence\":0.9,\"summary\":\"\",\"acceptedSourcePaths\":[\"\"],\"rejectedSourcePaths\":[\"\"]}. Reject unrelated titles, wrong episodes, and files that should not be moved into the target title. Do not invent paths.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const json = typeof content === "string" ? parseJsonObject(content) : content;
    return organizerReviewSchema.parse(json);
  } catch {
    return null;
  }
}

function heuristicGroups(
  candidates: AiCandidateInput[],
  summary = "Heuristic grouping used because OpenRouter is not configured.",
) {
  const grouped = new Map<string, AiCandidateInput[]>();

  for (const candidate of candidates) {
    const season = candidate.season ?? 1;
    const key = `${candidate.normalizedTitle}::${season}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  return [...grouped.values()].map((items) => ({
    normalizedTitle: items[0].normalizedTitle,
    displayTitle: items[0].parsedTitle,
    season: items[0].season ?? 1,
    candidateIds: items.map((item) => item.id),
    confidence: Math.min(...items.map((item) => 0.75 + (item.resolution ? 0.1 : 0))),
    aliases: [...new Set(items.map((item) => item.parsedTitle))],
    summary,
  }));
}

function parseJsonObject(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found");
    }
    return JSON.parse(match[0]);
  }
}
