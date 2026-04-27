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
