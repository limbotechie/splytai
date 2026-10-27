import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionVariant = "primary" | "secondary" | "ghost" | "danger";

export const panelClass = "min-w-0 rounded-[24px] border border-border/70 bg-card/80 p-5 sm:p-7";
export const fieldClass = "min-h-11 w-full min-w-0 rounded-full border border-border bg-background/70 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50 disabled:cursor-not-allowed disabled:opacity-50";

export function actionClass(variant: ActionVariant = "primary") {
  return cn(
    "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-center text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground/60 disabled:pointer-events-none disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/85",
    variant === "secondary" && "border border-border bg-background/50 text-foreground hover:bg-muted",
    variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
    variant === "danger" && "border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/20",
  );
}

export function Action({ variant, className, type = "button", ...props }: ComponentProps<"button"> & { variant?: ActionVariant }) {
  return <button type={type} className={cn(actionClass(variant), className)} {...props} />;
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(panelClass, className)} {...props} />;
}

export function Pill({ children, tone = "neutral", className }: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0",
      tone === "neutral" && "bg-muted text-muted-foreground",
      tone === "info" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
      tone === "success" && "bg-teal-500/10 text-teal-700 dark:text-teal-300",
      tone === "warning" && "bg-orange-500/10 text-orange-700 dark:text-orange-300",
      tone === "danger" && "bg-destructive/10 text-destructive",
      className,
    )}>{children}</span>
  );
}

export function PageHeader({ eyebrow, title, description, action, className }: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-6 sm:flex-row sm:items-end", className)}>
      <div className="min-w-0 max-w-3xl space-y-3">
        {eyebrow ? <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">{eyebrow}</p> : null}
        <h1 className="text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.08] font-medium tracking-[-0.045em] [overflow-wrap:anywhere]">{title}</h1>
        {description ? <div className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatePanel({ title, description, action, busy, tone = "neutral" }: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  busy?: boolean;
  tone?: "neutral" | "danger";
}) {
  const Icon = busy ? LoaderCircle : tone === "danger" ? CircleAlert : Sparkles;
  return (
    <Panel className="flex flex-col items-start gap-4 py-8 sm:py-10" role={tone === "danger" ? "alert" : "status"} aria-busy={busy}>
      <span className={cn("flex size-11 items-center justify-center rounded-full", tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
        <Icon size={19} className={busy ? "animate-spin" : undefined} aria-hidden />
      </span>
      <div className="min-w-0 space-y-2">
        <h2 className="text-lg font-medium tracking-tight">{title}</h2>
        {description ? <div className="max-w-lg text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{description}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2 pt-1">{action}</div> : null}
    </Panel>
  );
}
