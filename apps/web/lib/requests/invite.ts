import { decodeBase64Url } from "../private-workspace/format";
import { isUuid } from "../bills/manifest";
import { publicKeyFromRaw } from "./payload";
import type { InviteSecrets } from "./types";

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const PINNED_KEY = /^[A-Za-z0-9_-]{86}$/;
const MAX_FRAGMENT = 640;

function secret(value: unknown, label: string): string {
  if (typeof value !== "string" || !CAPABILITY.test(value) || decodeBase64Url(value).length !== 32) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

/**
 * Invitations are validated before any secret is persisted or used. The content
 * key travels only in the fragment, so the relay never learns it.
 */
export function validateInviteSecrets(value: unknown): InviteSecrets {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The private invitation is invalid.");
  const invite = value as Record<string, unknown>;
  const keys = Object.keys(invite).sort();
  if (keys.join(",") !== "contentKey,publicKey,readCapability,reportCapability,requestId,version") {
    throw new Error("The private invitation is invalid.");
  }
  if (invite.version !== 1 || !isUuid(invite.requestId)) throw new Error("The private invitation is invalid.");
  const readCapability = secret(invite.readCapability, "The read capability");
  const reportCapability = secret(invite.reportCapability, "The report capability");
  const contentKey = secret(invite.contentKey, "The content key");
  if (readCapability === reportCapability) throw new Error("The private invitation capabilities are invalid.");
  if (contentKey === readCapability || contentKey === reportCapability) throw new Error("The private invitation keys are not independent.");
  if (typeof invite.publicKey !== "string" || !PINNED_KEY.test(invite.publicKey)) throw new Error("The pinned signing key is invalid.");
  publicKeyFromRaw(invite.publicKey);
  return { version: 1, requestId: invite.requestId, readCapability, reportCapability, publicKey: invite.publicKey, contentKey };
}

/** Secrets belong only in the fragment, so they are never sent to a server or referrer. */
export function buildInviteFragment(invite: InviteSecrets): string {
  const checked = validateInviteSecrets(invite);
  return `#v=1&r=${checked.requestId}&k=${checked.readCapability}&w=${checked.reportCapability}&p=${checked.publicKey}&s=${checked.contentKey}`;
}

export function parseInviteFragment(input: string): InviteSecrets {
  if (typeof input !== "string" || input.length < 2 || input.length > MAX_FRAGMENT) throw new Error("This private invitation link is incomplete.");
  const fragment = input.startsWith("#") ? input.slice(1) : input;
  if (!fragment || fragment.startsWith("#") || fragment.startsWith("?") || fragment.includes("%")) {
    throw new Error("This private invitation link is incomplete.");
  }
  const parts = fragment.split("&");
  if (parts.length !== 6) throw new Error("This private invitation link is incomplete.");
  const values = new Map<string, string>();
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.indexOf("=", separator + 1) !== -1) throw new Error("This private invitation link is incomplete.");
    const key = part.slice(0, separator);
    if (values.has(key) || !["v", "r", "k", "w", "p", "s"].includes(key)) throw new Error("This private invitation link is incomplete.");
    values.set(key, part.slice(separator + 1));
  }
  if (values.get("v") !== "1") throw new Error("This private invitation link uses an unsupported version.");
  return validateInviteSecrets({
    version: 1,
    requestId: values.get("r"),
    readCapability: values.get("k"),
    reportCapability: values.get("w"),
    publicKey: values.get("p"),
    contentKey: values.get("s"),
  });
}

export function inviteUrl(appUrl: string, requestId: string, invite: InviteSecrets): string {
  if (!isUuid(requestId) || invite.requestId !== requestId) throw new Error("The invitation does not match this request.");
  const base = new URL(appUrl);
  if (base.username || base.password || base.search || base.hash) throw new Error("NEXT_PUBLIC_APP_URL must not contain credentials, a query or a fragment.");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) {
    throw new Error("Use HTTPS for the public app URL, except on localhost.");
  }
  const path = `${base.pathname.replace(/\/+$/, "")}/app/pay/${requestId}`;
  return `${base.origin}${path}${buildInviteFragment(invite)}`;
}

/** Removes a fragment from a URL without exposing its secret to the server or history. */
export function stripInviteFragment(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

/** Browser-only: replace the current entry so Back cannot reveal the captured secrets. */
export function clearInviteFragmentFromLocation(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  const clean = stripInviteFragment(window.location.href);
  window.history.replaceState(window.history.state, "", clean);
}
