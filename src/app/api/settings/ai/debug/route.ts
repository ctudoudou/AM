import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { getAppSettings } from "@/lib/settings";

const debugSchema = z.object({
  openRouterApiKey: z.string().optional(),
  model: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = debugSchema.parse(await request.json().catch(() => ({})));
    const settings = await getAppSettings();
    const apiKey = input.openRouterApiKey || settings.ai.openRouterApiKey;
    const model = input.model || settings.ai.model;

    if (!apiKey) {
      return jsonResponse(
        {
          ok: false,
          model,
          message: "OpenRouter API key is not configured.",
          hint: "Save an OpenRouter API key or enter one before testing.",
        },
        { status: 400 },
      );
    }

    const startedAt = Date.now();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Kura",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "Return exactly this JSON object and no markdown: {\"ok\":true,\"service\":\"openrouter\"}",
          },
          {
            role: "user",
            content: "Health check.",
          },
        ],
      }),
    });
    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return jsonResponse(
        {
          ok: false,
          status: response.status,
          model,
          latencyMs,
          message:
            payload?.error?.metadata?.raw ||
            payload?.error?.message ||
            response.statusText ||
            "OpenRouter request failed.",
          hint:
            response.status === 404
              ? "Model was not found. Use a model id supported by OpenRouter."
              : response.status === 400
                ? "The key is configured, but the selected model/provider rejected the request. Try a stable OpenRouter model id, or check whether this free/preview model is currently available."
              : "Check the API key, model id, and OpenRouter account status.",
        },
        { status: 200 },
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    const parsed = parseJsonObject(content);

    return jsonResponse({
      ok: Boolean(parsed?.ok),
      model,
      latencyMs,
      message: parsed?.ok
        ? "OpenRouter connection is available."
        : "OpenRouter responded, but the model did not return parseable JSON.",
      hint: parsed?.ok
        ? undefined
        : "The model may still work for chat, but Kura needs JSON output for grouping. Use a more instruction-following model if grouping quality is poor.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value) as { ok?: boolean };
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as { ok?: boolean };
    } catch {
      return null;
    }
  }
}
