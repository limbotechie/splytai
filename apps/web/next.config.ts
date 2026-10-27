import type { NextConfig } from "next";
import { relayConfiguration } from "./lib/requests/config";

const nextConfig: NextConfig = {
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    return config;
  },
  async headers() {
    const configuration = relayConfiguration(process.env.NEXT_PUBLIC_RELAY_URL);
    const relay = configuration.baseUrl ? ` ${new URL(configuration.baseUrl).origin}` : "";
    const dev = process.env.NODE_ENV !== "production";
    return [{ source: "/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${relay}${dev ? " ws://localhost:* ws://127.0.0.1:*" : ""}; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` },
    ] }, { source: "/app/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }];
  },
};

export default nextConfig;
