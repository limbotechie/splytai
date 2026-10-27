import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressParser } from "../address";

const require = createRequire(import.meta.url);
let parserPromise: Promise<AddressParser> | undefined;

/** Node loads the real WASM once: the binding caches views of its first memory. */
export function loadAddressParser(): Promise<AddressParser> {
  return parserPromise ??= (async () => {
    const directory = path.dirname(require.resolve("@elemental-zcash/zaddr_wasm_parser/package.json"));
    const binding = await import(pathToFileURL(path.join(directory, "zaddr_wasm_parser_bg.js")).href) as AddressParser & {
      __wbg_set_wasm(exports: Record<string, unknown>): void;
    };
    const bytes = new Uint8Array(readFileSync(path.join(directory, "zaddr_wasm_parser_bg.wasm")));
    const { instance } = await WebAssembly.instantiate(bytes, { "./zaddr_wasm_parser_bg.js": binding as unknown as WebAssembly.ModuleImports });
    binding.__wbg_set_wasm(instance.exports as Record<string, unknown>);
    (instance.exports as { __wbindgen_start(): void }).__wbindgen_start();
    return {
      is_valid_zcash_address: (address) => binding.is_valid_zcash_address(address),
      normalize_zcash_address: (address) => binding.normalize_zcash_address(address),
      get_zcash_address_type: (address) => binding.get_zcash_address_type(address),
      get_address_receivers: (address) => binding.get_address_receivers(address),
    };
  })();
}
