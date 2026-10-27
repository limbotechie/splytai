"use client";

import { Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteTemplate, listTemplates } from "@/lib/templates";
import type { Template } from "@/lib/templates";
import { Action, Panel, Pill } from "../common/Primitives";

interface Props {
  onSelect: (template: Template) => void;
  selectedId?: string;
  disabled?: boolean;
  onClear?: () => void;
}

export function TemplateList({ onSelect, selectedId, disabled, onClear }: Props) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTemplates()
      .then((items) => {
        if (!cancelled) setTemplates(items.sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch(() => { if (!cancelled) setError("Saved groups couldn't load. You can still add people manually."); });
    return () => { cancelled = true; };
  }, [attempt]);

  const handleDelete = async (id: string) => {
    if (deleting || disabled) return;
    setDeleting(id);
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev?.filter((t) => t.id !== id) ?? []);
      if (selectedId === id) onClear?.();
    } catch { setError("Couldn't delete that template. Please try again."); }
    finally { setDeleting(null); }
  };

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-medium tracking-tight">Reuse a group you have saved before.</h2><Users size={18} className="shrink-0 text-muted-foreground" /></div>
      <p className="text-sm leading-relaxed text-muted-foreground">Choose a saved group to reuse its participants and split method. Templates do not include receipt items or previous amounts, so you will review those separately.</p>
      {error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Action variant="secondary" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</Action></div> : null}
      {!templates && !error ? <p role="status" className="text-xs text-muted-foreground">Loading saved groups...</p> : null}
      {templates?.length === 0 ? <p className="rounded-[24px] bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">You have not saved a group in this browser yet. After creating a split, you can save its participants and method for future bills.</p> : null}
      <ul className="flex flex-col gap-2">
        {templates?.map((template) => (
          <li
            key={template.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[24px] border border-border/70 bg-background/40 p-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium [overflow-wrap:anywhere]">{template.name || "Unnamed template"}</span>
              <span className="text-xs text-muted-foreground">
                {template.members.length} member{template.members.length !== 1 ? "s" : ""} · {template.mode}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(template)}
                disabled={disabled}
                aria-pressed={selectedId === template.id}
                className="min-h-11 rounded-full bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition hover:bg-primary/20 disabled:opacity-50"
              >
                {selectedId === template.id ? <Pill tone="success">Selected</Pill> : "Use group"}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(template.id)}
                disabled={disabled || Boolean(deleting)}
                aria-label="Delete template"
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
