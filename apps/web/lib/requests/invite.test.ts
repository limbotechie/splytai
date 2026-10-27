import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInviteFragment, clearInviteFragmentFromLocation, inviteUrl, parseInviteFragment,
  stripInviteFragment, validateInviteSecrets,
} from "./invite";
import { generateSigningKeys, randomId, randomSecret } from "../private-workspace/crypto";
import { rawPublicKey } from "./payload";
import { installCrypto } from "../private-workspace/test-support";
import type { InviteSecrets } from "./types";

let invite: InviteSecrets;

beforeEach(async () => {
  installCrypto();
  const keys = await generateSigningKeys();
  invite = {
    version: 1,
    requestId: randomId(),
    readCapability: randomSecret(),
    reportCapability: randomSecret(),
    publicKey: rawPublicKey(keys.publicKey),
    contentKey: randomSecret(),
  };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("private invitation fragments", () => {
  it("round trips all six parts, including the content key", () => {
    const fragment = buildInviteFragment(invite);
    expect(fragment).toBe(`#v=1&r=${invite.requestId}&k=${invite.readCapability}&w=${invite.reportCapability}&p=${invite.publicKey}&s=${invite.contentKey}`);
    expect(parseInviteFragment(fragment)).toEqual(invite);
    expect(parseInviteFragment(fragment.slice(1))).toEqual(invite);
  });

  it("never accepts an invitation without its content key or with reordered duplicates", () => {
    const fragment = buildInviteFragment(invite);
    expect(() => parseInviteFragment(fragment.replace(/&s=[^&]+/, ""))).toThrow(/incomplete/);
    expect(() => parseInviteFragment(`${fragment}&s=${invite.contentKey}`)).toThrow(/incomplete/);
    expect(() => parseInviteFragment(fragment.replace("#v=1", "#v=2"))).toThrow(/unsupported version/);
    expect(() => parseInviteFragment(fragment.replace("&k=", "&k=%41"))).toThrow(/incomplete/);
    expect(() => parseInviteFragment("")).toThrow(/incomplete/);
    expect(() => parseInviteFragment("#")).toThrow(/incomplete/);
  });

  it("rejects reused capabilities and keys", () => {
    expect(() => validateInviteSecrets({ ...invite, reportCapability: invite.readCapability })).toThrow(/capabilities/);
    expect(() => validateInviteSecrets({ ...invite, contentKey: invite.readCapability })).toThrow(/not independent/);
    expect(() => validateInviteSecrets({ ...invite, contentKey: invite.reportCapability })).toThrow(/not independent/);
    expect(() => validateInviteSecrets({ ...invite, readCapability: "short" })).toThrow(/read capability/);
    expect(() => validateInviteSecrets({ ...invite, requestId: "not-a-uuid" })).toThrow(/invitation is invalid/);
    expect(() => validateInviteSecrets({ ...invite, extra: true })).toThrow(/invitation is invalid/);
    expect(() => validateInviteSecrets({ ...invite, publicKey: "A".repeat(85) })).toThrow();
  });

  it("builds an HTTPS link with secrets only after the hash", () => {
    const url = inviteUrl("https://splyt.example/app", invite.requestId, invite);
    expect(url).toBe(`https://splyt.example/app/app/pay/${invite.requestId}${buildInviteFragment(invite)}`);
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(buildInviteFragment(invite));
    expect(url.startsWith("https://splyt.example/app/app/pay/")).toBe(true);
  });

  it("permits localhost HTTP for development only", () => {
    expect(() => inviteUrl("http://localhost:3000", invite.requestId, invite)).not.toThrow();
    expect(() => inviteUrl("http://127.0.0.1:3000", invite.requestId, invite)).not.toThrow();
    expect(() => inviteUrl("http://splyt.example", invite.requestId, invite)).toThrow(/HTTPS/);
    expect(() => inviteUrl("https://user:pass@splyt.example", invite.requestId, invite)).toThrow(/credentials/);
    expect(() => inviteUrl("https://splyt.example?x=1", invite.requestId, invite)).toThrow(/query/);
    expect(() => inviteUrl("https://splyt.example/#frag", invite.requestId, invite)).toThrow(/query|fragment/);
    expect(() => inviteUrl("https://splyt.example", randomId(), invite)).toThrow(/does not match/);
  });

  it("strips the fragment before anything is persisted or navigated to", () => {
    const url = inviteUrl("https://splyt.example", invite.requestId, invite);
    const clean = stripInviteFragment(url);
    expect(clean).toBe(`https://splyt.example/app/pay/${invite.requestId}`);
    expect(clean).not.toContain(invite.contentKey);
    expect(clean).not.toContain("#");
  });

  it("clears the live fragment with replaceState when a browser window exists", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      isSecureContext: true,
      location: { href: `https://splyt.example/app/pay/${invite.requestId}${buildInviteFragment(invite)}`, hash: buildInviteFragment(invite) },
      history: { state: { page: 1 }, replaceState },
    });
    clearInviteFragmentFromLocation();
    expect(replaceState).toHaveBeenCalledWith({ page: 1 }, "", `https://splyt.example/app/pay/${invite.requestId}`);
  });
});
