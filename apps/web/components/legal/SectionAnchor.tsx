"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";

export function SectionAnchor({ id }: { id: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    window.history.replaceState(window.history.state, "", `#${id}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <a
      href={`#${id}`}
      onClick={handleClick}
      aria-label="Copy link to section"
      className="ml-2 inline-flex items-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
    >
      <Link2 size={14} aria-hidden="true" />
      <span className="sr-only" role="status">
        {copyState === "copied" ? "Section link copied." : copyState === "failed" ? "Could not copy. The section link is in your address bar." : ""}
      </span>
    </a>
  );
}
