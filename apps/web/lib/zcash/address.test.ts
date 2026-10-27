import { beforeAll, describe, expect, it } from "vitest";
import {
  inspectAddress, type AddressParser, type ShieldedAddress,
} from "./address";
import type { Network } from "../bills/types";
import { loadAddressParser } from "./__tests__/parser";

/**
 * Network fixtures. The Sapling addresses are genuine mainnet/testnet encodings.
 * The Unified Addresses below are spec-shaped; the pinned `zcash_address` 0.7.0
 * parser only accepts the full transparent+Sapling+Orchard encoding, so the
 * shielded-only cases are exercised through a parser double.
 */
const MAINNET_SAPLING = "zs1jap4fpzz4wj0uh7zavxsju6xrqud6gdkelx4gng8h0t30qv5huz6ar4hpvsxr6tdvza9zasweve";
const TESTNET_SAPLING = "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez";
const TRANSPARENT = "t1XUKmDLFcRDxvf9A7tawmgePDN8NK6os35";
const MIXED_UA = "u1mq04mn6p50lvt0p4wdslweg8tffm3d0vn6tnyz4ry7dgrh35tw2ykzf7luh77qgsgl8wcl0a2fylvk3en5csd9nrhwdzvf8tdey9vfmuk98vj6de8msslwrh4rs06q8upcnsj5pqzq7vcestnlr08gjycj72z0pdpg02y2c2a2mcutardqpflq4p00udr7tktmyp99crfcfg6e2s30d";
const SAPLING_UA = "u12308vnzh3kekauwnk9asnrtg8gxgup0p6p66xdwp88xgt7ustmypsxqg8ygr0hundtxm25a96weq9sepeeeawpu69yxx73egqyx9r4q0";
const ORCHARD_UA = "u173sq53h88q6p8qdm7wswheej0tsmvapqj8wsfl3gy89laec7p6gy5g4lprc238z4w84j4lh97tw5sx5z8rtvrss3z7cf5vg3xy39da0g";
const SHIELDED_UA = "u18f275jccga5d8ntqh4v5azza26lu0r8sxd8dnru24wtyl4rag3sy5sdvhzxxhwth0yxct4sxkwa74nljss8t3fq6m68k47cfqz6z997jycpzj9dnjjphydcj0vlnhdregers5nwaarg4ex6wsxmqjnf7qrs33znke023el0mfysvae5m";

interface Double {
  type: "sapling" | "unified" | "p2pkh";
  receivers: Record<string, string>;
}

function parserFor(table: Record<string, Double>): AddressParser {
  const lookup = (address: string): Double => {
    const entry = table[address];
    if (!entry) throw new Error("unknown fixture");
    return entry;
  };
  return {
    is_valid_zcash_address: (address) => Boolean(table[address]),
    normalize_zcash_address: (address) => {
      lookup(address);
      return address;
    },
    get_zcash_address_type: (address) => lookup(address).type,
    get_address_receivers: (address) => lookup(address).receivers,
  };
}

function accept(receiver: ShieldedAddress, address: string, network: Network): void {
  expect(receiver).toEqual({ address, network, type: "sapling", receivers: ["sapling"] });
}

describe("shielded receiving addresses with the real parser", () => {
  let parser: AddressParser;
  beforeAll(async () => { parser = await loadAddressParser(); });

  it("accepts a genuine mainnet Sapling address and reports only Sapling", () => {
    accept(inspectAddress(MAINNET_SAPLING, "mainnet", parser), MAINNET_SAPLING, "mainnet");
  });

  it("accepts the matching testnet Sapling address and rejects a network mismatch", () => {
    accept(inspectAddress(TESTNET_SAPLING, "testnet", parser), TESTNET_SAPLING, "testnet");
    expect(() => inspectAddress(TESTNET_SAPLING, "mainnet", parser)).toThrow(/must be for mainnet/);
    expect(() => inspectAddress(MAINNET_SAPLING, "testnet", parser)).toThrow(/must be for testnet/);
  });

  it("rejects transparent and mixed Unified Addresses", () => {
    expect(() => inspectAddress(TRANSPARENT, "mainnet", parser)).toThrow(/Transparent addresses are not accepted/);
    expect(() => inspectAddress(MIXED_UA, "mainnet", parser)).toThrow(/transparent or legacy fallback/);
  });

  it("rejects padded text, invalid checksums and non-canonical casing", () => {
    expect(() => inspectAddress(`pay ${MAINNET_SAPLING}`, "mainnet", parser)).toThrow(/valid checksum/);
    expect(() => inspectAddress(`${MAINNET_SAPLING}x`, "mainnet", parser)).toThrow(/valid checksum/);
    expect(() => inspectAddress(MAINNET_SAPLING.slice(0, -1) + "q", "mainnet", parser)).toThrow(/valid checksum/);
    expect(() => inspectAddress(MAINNET_SAPLING.toUpperCase(), "mainnet", parser)).toThrow(/canonical|valid checksum/);
  });

  it("trims only surrounding whitespace and still validates the address", () => {
    accept(inspectAddress(`  ${MAINNET_SAPLING}\n`, "mainnet", parser), MAINNET_SAPLING, "mainnet");
  });

  it.each([TRANSPARENT, MIXED_UA, TESTNET_SAPLING])("refuses to treat %s as shielded-only mainnet", (address) => {
    expect(() => inspectAddress(address, "mainnet", parser)).toThrow();
  });
});

describe("shielded-only Unified Addresses through the parser boundary", () => {
  const table: Record<string, Double> = {
    [SAPLING_UA]: { type: "unified", receivers: { sapling: MAINNET_SAPLING } },
    [ORCHARD_UA]: {
      type: "unified",
      receivers: { orchard: "u1qgqtyww4xfuq5u4dudpgcp4twvdtdx70lwvmz9gjjlet57n7nc76megvdz4pqn56gn5afm30yqmf2xw7qadwl8swxaev8c26557cyk9x" },
    },
    [SHIELDED_UA]: { type: "unified", receivers: { sapling: MAINNET_SAPLING, orchard: "u1qgqtyww4xfuq5u4dudpgcp4twvdtdx70lwvmz9gjjlet57n7nc76megvdz4pqn56gn5afm30yqmf2xw7qadwl8swxaev8c26557cyk9x" } },
    [MIXED_UA]: { type: "unified", receivers: { sapling: MAINNET_SAPLING, orchard: "u1qgqtyww4xfuq5u4dudpgcp4twvdtdx70lwvmz9gjjlet57n7nc76megvdz4pqn56gn5afm30yqmf2xw7qadwl8swxaev8c26557cyk9x" } },
  };
  const parser = parserFor(table);

  it("accepts Sapling-only, Orchard-only and Sapling+Orchard Unified Addresses", () => {
    expect(inspectAddress(SAPLING_UA, "mainnet", parser)).toEqual({
      address: SAPLING_UA, network: "mainnet", type: "unified", receivers: ["sapling"],
    });
    expect(inspectAddress(ORCHARD_UA, "mainnet", parser).receivers).toEqual(["orchard"]);
    expect(inspectAddress(SHIELDED_UA, "mainnet", parser).receivers).toEqual(["sapling", "orchard"]);
  });

  it("rejects a Unified Address whose encoding is longer than its known receivers explain", () => {
    expect(() => inspectAddress(MIXED_UA, "mainnet", parser)).toThrow(/unsupported receiver/);
  });

  it("rejects transparent fallback, unknown receiver keys and Sapling-only types with extra receivers", () => {
    const transparent = parserFor({ [MIXED_UA]: { type: "unified", receivers: { p2pkh: TRANSPARENT, sapling: MAINNET_SAPLING } } });
    expect(() => inspectAddress(MIXED_UA, "mainnet", transparent)).toThrow(/transparent or legacy fallback/);

    const unknown = parserFor({ [MIXED_UA]: { type: "unified", receivers: { future: "u1future" } } });
    expect(() => inspectAddress(MIXED_UA, "mainnet", unknown)).toThrow(/unsupported receiver format/);

    const wrongType = parserFor({ [MAINNET_SAPLING]: { type: "sapling", receivers: { sapling: MAINNET_SAPLING, orchard: "u1qgqty" } } });
    expect(() => inspectAddress(MAINNET_SAPLING, "mainnet", wrongType)).toThrow(/unexpected receiver/);
  });

  it("rejects addresses with no supported shielded receiver", () => {
    const empty = parserFor({ [SAPLING_UA]: { type: "unified", receivers: {} } });
    expect(() => inspectAddress(SAPLING_UA, "mainnet", empty)).toThrow(/No supported shielded receiver/);
  });

  it("rejects a non-object receiver payload", () => {
    const broken: AddressParser = {
      is_valid_zcash_address: () => true,
      normalize_zcash_address: (address) => address,
      get_zcash_address_type: () => "unified",
      get_address_receivers: () => null,
    };
    expect(() => inspectAddress(SAPLING_UA, "mainnet", broken)).toThrow(/not supported/);
  });
});
