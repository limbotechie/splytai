"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function PrimaryAction() {
  return (
    <Link
      href="/app/scan"
      className="group relative flex min-h-13 min-w-0 items-center justify-between gap-8 rounded-full bg-primary p-1 ps-6 pe-1 text-primary-foreground transition hover:bg-primary/85"
    >
      <span className="py-2 text-sm font-medium">Start a new split</span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground transition group-hover:rotate-45">
        <ArrowUpRight size={16} />
      </span>
    </Link>
  );
}
