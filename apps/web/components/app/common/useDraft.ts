"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { getDraft, putDraft } from "@/lib/draft";
import type { DraftSession } from "@/lib/types";

export function useDraft(id: string, autoSave = false) {
  const [draft, setDraft] = useState<DraftSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<DraftSession | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getDraft(id).then((value) => {
      if (cancelled) return;
      setDraft(value);
      setSavedDraft(value);
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) { setLoadError("This browser couldn't open your saved draft. Please try again."); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [id, attempt]);

  async function save(value = draft) {
    if (!value) return false;
    const current = ++revision.current;
    setSaving(true);
    setSaveError(null);
    // Serialize writes so an older autosave cannot replace newer edits.
    const write = queue.current.catch(() => {}).then(async () => {
      if (typeof indexedDB === "undefined") throw new Error("Storage unavailable");
      await putDraft(value);
    });
    queue.current = write;
    try {
      await write;
      if (current === revision.current) setSavedDraft(value);
      return true;
    } catch {
      if (current === revision.current) setSaveError("Couldn't save your changes. Keep this page open and try again.");
      return false;
    } finally {
      if (current === revision.current) setSaving(false);
    }
  }

  const persistLatest = useEffectEvent(() => { void save(); });
  useEffect(() => {
    if (!autoSave || !draft || draft === savedDraft) return;
    const timer = setTimeout(() => persistLatest(), 250);
    return () => clearTimeout(timer);
  }, [autoSave, draft, savedDraft]);

  return {
    draft, setDraft, saving, saveError, save,
    loading: !loaded,
    loadError,
    missing: loaded && !loadError && !draft,
    saved: Boolean(draft && draft === savedDraft),
    reload: () => { setLoaded(false); setLoadError(null); setAttempt((value) => value + 1); },
  };
}
