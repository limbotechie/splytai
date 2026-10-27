import { webcrypto } from "node:crypto";
import { vi } from "vitest";

export const nativeCrypto = webcrypto as unknown as Crypto;
const NativeCryptoKey = globalThis.CryptoKey;

export function installCrypto(indexedDB?: IDBFactory): void {
  vi.stubGlobal("crypto", nativeCrypto);
  vi.stubGlobal("CryptoKey", NativeCryptoKey);
  vi.stubGlobal("window", { isSecureContext: true, crypto: nativeCrypto, indexedDB });
  vi.stubGlobal("indexedDB", indexedDB);
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function rawDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open("splyt-private-v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storedValues<T>(store: string): Promise<T[]> {
  const database = await rawDatabase();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const tx = database.transaction(store, "readonly");
      const request = tx.objectStore(store).getAll();
      tx.oncomplete = () => resolve(request.result as T[]);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

export async function mutateStore(store: string, mutate: (store: IDBObjectStore) => void): Promise<void> {
  const database = await rawDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(store, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      mutate(tx.objectStore(store));
    });
  } finally {
    database.close();
  }
}
