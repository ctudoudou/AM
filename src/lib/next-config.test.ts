import { describe, expect, it } from "vitest";
import nextConfig, {
  buildContentSecurityPolicy,
  securityHeaders,
} from "../../next.config";

describe("Next.js security headers", () => {
  it("disables the framework signature and applies baseline headers globally", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    await expect(nextConfig.headers?.()).resolves.toEqual([
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ]);

    const headerNames = new Set(securityHeaders.map((header) => header.key));
    expect(headerNames).toEqual(
      new Set([
        "Content-Security-Policy",
        "Referrer-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "X-DNS-Prefetch-Control",
        "Permissions-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
      ]),
    );
  });

  it("prevents framing and restricts active content to the application origin", () => {
    const headers = new Map(securityHeaders.map(({ key, value }) => [key, value]));
    const policy = headers.get("Content-Security-Policy");

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("allows current media sources and development hot reload without relaxing production", () => {
    const developmentPolicy = buildContentSecurityPolicy("development");
    const productionPolicy = buildContentSecurityPolicy("production");

    expect(developmentPolicy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(developmentPolicy).toContain("connect-src 'self' ws: wss:");
    expect(productionPolicy).not.toContain("'unsafe-eval'");
    expect(productionPolicy).not.toContain(" ws: wss:");
    expect(productionPolicy).toContain("img-src 'self' data: blob: https:");
    expect(productionPolicy).toContain("media-src 'self' blob:");
    expect(productionPolicy).toContain("worker-src 'self' blob:");
  });
});
