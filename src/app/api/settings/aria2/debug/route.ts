import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { getAppSettings } from "@/lib/settings";

const debugSchema = z.object({
  rpcUrl: z.string().trim().url().optional(),
  rpcSecret: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = debugSchema.parse(await request.json().catch(() => ({})));
    const settings = await getAppSettings();
    const rpcUrl = input.rpcUrl || settings.aria2.rpcUrl;
    const rpcSecret =
      input.rpcSecret && input.rpcSecret.length > 0
        ? input.rpcSecret
        : settings.aria2.rpcSecret;
    const startedAt = Date.now();

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "kura-debug",
        method: "aria2.getVersion",
        params: rpcSecret ? [`token:${rpcSecret}`] : [],
      }),
    });
    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.error) {
      return jsonResponse({
        ok: false,
        status: response.status,
        latencyMs,
        message:
          payload?.error?.message ||
          response.statusText ||
          "aria2 JSON-RPC request failed.",
        hint:
          payload?.error?.code === 1
            ? "The aria2 RPC secret is wrong or missing."
            : "Check ARIA2_RPC_URL, RPC secret, and whether aria2c is running with --enable-rpc.",
      });
    }

    return jsonResponse({
      ok: true,
      status: response.status,
      latencyMs,
      version: payload?.result?.version,
      enabledFeatures: payload?.result?.enabledFeatures,
      message: payload?.result?.version
        ? `aria2 ${payload.result.version} is available.`
        : "aria2 JSON-RPC is available.",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return jsonResponse({
        ok: false,
        message: "aria2 JSON-RPC request timed out.",
        hint: "Check whether aria2 is running and reachable from the Next.js server.",
      });
    }
    return jsonError(error);
  }
}
