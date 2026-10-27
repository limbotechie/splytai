import type { Address, SplitMode } from "./types";

export interface Template {
  id: string;
  name: string;
  members: Address[];
  mode: SplitMode;
  createdAt: number;
}

const DB_NAME = "splyt-templates";
const STORE_NAME = "templates";
const DB_VERSION = 1;

function openTemplatesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listTemplates(): Promise<Template[]> {
  const db = await openTemplatesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as Template[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function saveTemplate(template: Template): Promise<void> {
  const db = await openTemplatesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(template);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openTemplatesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
