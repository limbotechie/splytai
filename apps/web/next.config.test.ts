import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config";
import { relayConfiguration } from "./lib/requests/config";

afterEach(() => vi.unstubAllEnvs());

async function connectionPolicy(): Promise<string> {
  const routes = await nextConfig.headers!();
  const policy = routes.find((route) => route.source === "/:path*")?.headers
    .find((header) => header.key === "Content-Security-Policy")?.value;
  if (!policy) throw new Error("Missing content security policy.");
  return policy.split(";").find((directive) => directive.trim().startsWith("connect-src"))!.trim();
}

describe("real relay configuration", () => {
  it("keeps missing or invalid production configuration closed without a localhost fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of [undefined, "", "not a URL", "http://localhost:3001", "https://relay.example?secret=1"]) {
      vi.stubEnv("NEXT_PUBLIC_RELAY_URL", value);
      expect(relayConfiguration(value)).toMatchObject({ baseUrl: null, error: expect.any(String) });
      expect(await connectionPolicy()).toBe("connect-src 'self'");
    }
  });

  it("permits only the explicitly configured HTTPS relay origin in production CSP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_RELAY_URL", "https://relay.example/private/");
    expect(relayConfiguration("https://relay.example/private/")).toEqual({ baseUrl: "https://relay.example/private", error: null });
    expect(await connectionPolicy()).toBe("connect-src 'self' https://relay.example");
  });

  it("allows explicit loopback configuration for real local development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(relayConfiguration("http://localhost:3001")).toEqual({ baseUrl: "http://localhost:3001", error: null });
    expect(relayConfiguration(undefined).baseUrl).toBeNull();
  });
});
