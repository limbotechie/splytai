export interface RelayConfiguration {
  baseUrl: string | null;
  error: string | null;
}

export function relayConfiguration(value: string | undefined): RelayConfiguration {
  if (!value?.trim()) {
    return { baseUrl: null, error: "The live relay is not configured. Set NEXT_PUBLIC_RELAY_URL to its HTTPS endpoint and rebuild the web app." };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { baseUrl: null, error: "NEXT_PUBLIC_RELAY_URL must be a valid HTTPS relay URL." };
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const localDevelopment = loopback && process.env.NODE_ENV !== "production";
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopment)) ||
    (loopback && !localDevelopment)) {
    return { baseUrl: null, error: "NEXT_PUBLIC_RELAY_URL must use HTTPS without credentials, query parameters, or fragments. Loopback is allowed only for explicitly configured local development." };
  }

  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, error: null };
}
