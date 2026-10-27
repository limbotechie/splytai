"use client";

import { X, UserPlus, Users, UserCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Action, Pill, fieldClass } from "../common/Primitives";

export interface MemberEntry {
  id: string;
  label: string;
  isOrganiser: boolean;
}

interface Props {
  members: string[]; // List of labels / names
  includeOrganiser: boolean;
  onMembersChange: (next: string[]) => void;
  onIncludeOrganiserChange: (include: boolean) => void;
}

export function MembersEditor({
  members,
  includeOrganiser,
  onMembersChange,
  onIncludeOrganiserChange,
}: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const candidate = input.trim();
    if (!candidate) {
      setError("Please enter a name or nickname.");
      return;
    }
    if (candidate.length > 50) {
      setError("Name must be under 50 characters.");
      return;
    }
    if (members.some((m) => m.toLowerCase() === candidate.toLowerCase())) {
      setError("A participant with this name is already added.");
      return;
    }
    if (members.length + (includeOrganiser ? 1 : 0) >= 50) {
      setError("Maximum 50 participants per bill.");
      return;
    }

    onMembersChange([...members, candidate]);
    setInput("");
    setError(null);
    inputRef.current?.focus();
  };

  const remove = (name: string) => {
    onMembersChange(members.filter((m) => m !== name));
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label htmlFor="member-input" className="text-sm font-medium">
          Add participants
        </label>
        <p className="text-xs text-muted-foreground">
          Enter the names or nicknames of people sharing the bill. Each person will receive a private invitation link.
        </p>
        <div className="flex gap-2">
          <input
            id="member-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="e.g. Alice, Bob, Charlie"
            className={fieldClass}
            maxLength={50}
          />
          <Action onClick={add} variant="secondary" className="shrink-0">
            <UserPlus /> Add
          </Action>
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>

      {/* Organiser participation toggle */}
      <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/50 p-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Include yourself in the split</p>
            <Pill tone="info" className="py-0 px-2 text-[10px]">You / Organiser</Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            Whether your own share should be accounted for in the bill total.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeOrganiser}
          aria-label="Include your organiser share"
          disabled={!includeOrganiser && members.length >= 50}
          onClick={() => onIncludeOrganiserChange(!includeOrganiser)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            includeOrganiser ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`pointer-events-none inline-block size-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
              includeOrganiser ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Members list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Participants ({members.length + (includeOrganiser ? 1 : 0)})
          </h4>
        </div>

        <div className="space-y-2">
          {includeOrganiser ? (
            <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <UserCheck size={16} className="text-teal-500" /> You (Organiser)
              </span>
              <Pill tone="success" className="text-[10px]">Hosting</Pill>
            </div>
          ) : null}

          {members.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm transition-colors hover:border-border"
            >
              <span className="flex items-center gap-2 font-medium">
                <Users size={15} className="text-muted-foreground" /> {name}
              </span>
              <button
                type="button"
                onClick={() => remove(name)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${name}`}
              >
                <X size={15} />
              </button>
            </div>
          ))}

          {members.length === 0 && !includeOrganiser ? (
            <p className="rounded-xl border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground">
              No participants added yet. Enter names above to invite people.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
