"use client";

import type { DraftSession } from "./types";
import { deleteRecord, listRecords, readRecord, writeRecord } from "./private-workspace/storage";

export async function getDraft(id: string): Promise<DraftSession | null> {
  const record = await readRecord<DraftSession>(`draft:${id}`);
  if (!record) return null;
  if (record.value.id !== id) throw new Error("The saved draft identifier is invalid.");
  return record.value;
}

export async function putDraft(draft: DraftSession): Promise<void> {
  const id = `draft:${draft.id}`;
  const existing = await readRecord<DraftSession>(id);
  await writeRecord(id, draft, existing?.revision ?? null);
}

export async function deleteDraft(id: string): Promise<void> {
  const record = await readRecord(`draft:${id}`);
  if (record) await deleteRecord(record.id, record.revision);
}

export async function listDrafts(): Promise<DraftSession[]> {
  const records = await listRecords<DraftSession>("draft:");
  return records.map((record) => {
    if (record.id !== `draft:${record.value.id}`) throw new Error("The saved draft identifier is invalid.");
    return record.value;
  });
}

export async function getDraftCount(): Promise<number> {
  return (await listDrafts()).length;
}

export async function purgeOldDrafts(olderThanDays: number): Promise<void> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const all = await listDrafts();
  await Promise.all(
    all.filter((d) => d.createdAt < cutoff).map((d) => deleteDraft(d.id))
  );
}
