"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { BookOpen, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Dock } from "./Dock";
import { useWorkspace } from "@/context/WorkspaceContext";
import { actionClass, Pill } from "../common/Primitives";
import styles from "../common/AppSurface.module.css";

const DOCK_HIDDEN_PATTERNS = [
  /^\/app\/bills\/[^/]+$/,
  /^\/app\/pay\//,
];

export function DockShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { network, status, isSupported, relayConnection, refreshRelay } = useWorkspace();
  const showDock = !DOCK_HIDDEN_PATTERNS.some((re) => re.test(pathname));

  const needsBackup = !status || status.uncoveredRecords > 0 || !status.lastExportAt;
  const StatusIcon = needsBackup ? ShieldAlert : ShieldCheck;

  return (
    <MotionConfig reducedMotion="user">
      <div className={`${styles.surface} relative flex min-h-dvh w-full flex-col`}>
        <div className={styles.ambient} aria-hidden />
        <a
          href="#app-content"
          className="sr-only z-50 rounded-full bg-primary px-5 py-3 text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-4"
        >
          Skip to content
        </a>
        <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 sm:px-6 lg:px-10">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-5 sm:py-6">
            <div className="flex items-center gap-5">
              <Link href="/" aria-label="Splyt home" className="text-2xl font-semibold tracking-[-0.06em]">
                splyt.
              </Link>
              <span className="hidden border-l border-border pl-5 text-xs text-muted-foreground lg:block">
                Private, browser-encrypted ZEC reimbursements.
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Link href="/docs" aria-label="Read the documentation" className={`${actionClass("ghost")} px-3 text-xs`}>
                <BookOpen aria-hidden />
                <span className="hidden sm:inline">Docs</span>
              </Link>
              <Link
                href="/app/settings"
                className={`${actionClass("secondary")} gap-2 px-4 text-xs`}
                aria-label="Workspace settings and backup"
              >
                <StatusIcon aria-hidden className={needsBackup ? "text-amber-500" : "text-teal-500"} />
                <span>Workspace</span>
                <Pill tone={network === "mainnet" ? "warning" : "info"} className="py-0.5 px-2 text-[10px]">
                  {network}
                </Pill>
                {isSupported ? (
                  <span
                    className={`size-1.5 rounded-full ${needsBackup ? "bg-amber-500" : "bg-teal-500"}`}
                    aria-label={!status ? "Backup status unavailable" : needsBackup ? "Backup recommended" : "Backup up to date"}
                  />
                ) : null}
              </Link>
            </div>
          </header>
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3 text-xs">
            <div className="min-w-0 space-y-1">
              <p className={relayConnection.status === "connected" ? "text-teal-700 dark:text-teal-300" : "text-muted-foreground"}>
                {relayConnection.status === "connected" ? "Relay connected"
                  : relayConnection.status === "checking" ? "Checking relay connection"
                  : relayConnection.status === "offline" ? "Relay offline" : "Relay not configured"}
              </p>
              {relayConnection.error ? <p className="text-destructive [overflow-wrap:anywhere]">{relayConnection.error}</p> : null}
              {relayConnection.checkedAt ? <p className="text-muted-foreground">Last successful relay check: {new Date(relayConnection.checkedAt).toLocaleString()}. This is not a wallet or blockchain connection.</p> : null}
            </div>
            <button type="button" onClick={refreshRelay} disabled={relayConnection.status === "checking"} className={`${actionClass("ghost")} px-3 text-xs`}>
              <RefreshCw size={13} className={relayConnection.status === "checking" ? "animate-spin" : undefined} />
              {relayConnection.status === "connected" ? "Check relay" : "Retry relay"}
            </button>
          </div>
          <main
            id="app-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col outline-none"
            style={{ paddingBottom: showDock ? "calc(7.5rem + env(safe-area-inset-bottom))" : "2rem" }}
          >
            {children}
          </main>
        </div>
        {showDock ? <Dock /> : null}
      </div>
    </MotionConfig>
  );
}
