import fs from "node:fs/promises";
import { getAppSettings } from "@/lib/settings";

type Aria2Status = {
  gid: string;
  status: "active" | "waiting" | "paused" | "complete" | "error" | "removed";
  totalLength?: string;
  completedLength?: string;
  downloadSpeed?: string;
  errorMessage?: string;
  files?: Array<{
    path?: string;
    length?: string;
    completedLength?: string;
    selected?: string;
  }>;
};

export async function aria2Request<T>(method: string, params: unknown[] = []) {
  const settings = await getAppSettings();
  const tokenParams = settings.aria2.rpcSecret
    ? [`token:${settings.aria2.rpcSecret}`, ...params]
    : params;
  const response = await fetch(settings.aria2.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kura",
      method: `aria2.${method}`,
      params: tokenParams,
    }),
  });

  if (!response.ok) {
    throw new Error(`aria2 request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "aria2 error");
  }
  return payload.result as T;
}

export async function addMagnetToAria2(magnetUrl: string, dir?: string) {
  return aria2Request<string>("addUri", [[magnetUrl], dir ? { dir } : {}]);
}

export async function addTorrentToAria2(torrentFilePath: string, dir?: string) {
  const torrent = await fs.readFile(torrentFilePath);
  return addTorrentBytesToAria2(torrent, dir);
}

export async function addTorrentUrlToAria2(torrentUrl: string, dir?: string) {
  const response = await fetch(torrentUrl, {
    headers: { "User-Agent": "Kura/0.1 aria2 torrent fetcher" },
  });
  if (!response.ok) {
    throw new Error(`Torrent fetch failed: ${response.status} ${response.statusText}`);
  }
  const torrent = Buffer.from(await response.arrayBuffer());
  return addTorrentBytesToAria2(torrent, dir);
}

function addTorrentBytesToAria2(torrent: Buffer, dir?: string) {
  return aria2Request<string>("addTorrent", [
    torrent.toString("base64"),
    [],
    dir ? { dir } : {},
  ]);
}

export async function tellKnownDownload(gid: string) {
  return aria2Request<Aria2Status>("tellStatus", [
    gid,
    [
      "gid",
      "status",
      "totalLength",
      "completedLength",
      "downloadSpeed",
      "errorMessage",
      "files",
    ],
  ]);
}

export function mapAria2Status(status: Aria2Status["status"]) {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "waiting":
      return "WAITING";
    case "paused":
      return "PAUSED";
    case "complete":
      return "COMPLETED";
    case "error":
    case "removed":
      return "FAILED";
  }
}
