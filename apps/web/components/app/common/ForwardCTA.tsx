"use client";

import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type CommonProps = {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
};

type AsLink = CommonProps & { href: string; onClick?: never; type?: never };
type AsButton = CommonProps & {
  href?: never;
  onClick: () => void;
  type?: "button" | "submit";
};

export function ForwardCTA(props: AsLink | AsButton) {
  const { label, disabled, busy, className } = props;
  const body = (
    <>
      <span className="min-w-0 py-3 text-sm font-medium">{label}</span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpRight size={18} />}
      </span>
    </>
  );

  const classes = cn(
    "group flex min-w-0 items-center justify-between gap-3 rounded-full bg-primary p-1 ps-6 pe-1 text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground/60",
    className
  );

  if ("href" in props && props.href) {
    if (disabled || busy) return <span aria-disabled="true" className={cn(classes, "opacity-50")}>{body}</span>;
    return (
      <Link href={props.href} className={classes}>
        {body}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={classes}
    >
      {body}
    </button>
  );
}
