import dns from "node:dns/promises";
import net from "node:net";

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class VideoSourceNetworkError extends Error {}

type LookupAddress = { address: string; family: number };
type LookupAll = (hostname: string) => Promise<LookupAddress[]>;

export async function assertPublicHttpUrl(
  input: string | URL,
  lookupAll: LookupAll = defaultLookupAll,
) {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new VideoSourceNetworkError("Only public HTTP or HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new VideoSourceNetworkError("Source URLs cannot contain credentials.");
  }
  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname, family: net.isIP(url.hostname) }]
    : await lookupAll(url.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new VideoSourceNetworkError("Source URL resolves to a private or unsafe network.");
  }
  return url;
}

export async function fetchPublicHtml(
  input: string | URL,
  options: {
    fetchImpl?: typeof fetch;
    lookupAll?: LookupAll;
    maxRedirects?: number;
    maxBytes?: number;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupAll = options.lookupAll ?? defaultLookupAll;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? MAX_HTML_BYTES;
  let current = await assertPublicHttpUrl(input, lookupAll);

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36 Kura/0.1",
      },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new VideoSourceNetworkError("Source returned a redirect without a location.");
      }
      current = await assertPublicHttpUrl(new URL(location, current), lookupAll);
      continue;
    }
    if (!response.ok) {
      throw new VideoSourceNetworkError(
        `Source page request failed: ${response.status} ${response.statusText}`,
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new VideoSourceNetworkError("Source did not return an HTML page.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new VideoSourceNetworkError("Source page is larger than the allowed inspection size.");
    }
    return readLimitedText(response, maxBytes);
  }

  throw new VideoSourceNetworkError("Source page exceeded the redirect limit.");
}

export function isBlockedAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) {
    return isBlockedAddress(normalized.slice("::ffff:".length));
  }
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(normalized)) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }
  return true;
}

async function defaultLookupAll(hostname: string) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new VideoSourceNetworkError("Source page exceeded the allowed inspection size.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}
