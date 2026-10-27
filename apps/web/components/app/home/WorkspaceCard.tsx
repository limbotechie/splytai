"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock, ShieldCheck, ShieldAlert, ArrowUpRight, HardDrive } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { listLocalBills } from "@/lib/workflow/bill";
import { Panel, Pill, actionClass } from "@/components/app/common/Primitives";

export function WorkspaceCard() {
  const { network, status, isSupported } = useWorkspace();
  const [billCount, setBillCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLocalBills()
      .then((bills) => {
        if (active) setBillCount(bills.length);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "The local bills could not be read. Check browser storage permissions.");
      });
    return () => {
      active = false;
    };
  }, []);

  const needsBackup = !status || status.uncoveredRecords > 0 || !status.lastExportAt;

  return (
    <Panel className="flex flex-col gap-5 bg-linear-to-br from-card via-card to-muted/40">
      <div className="flex items-center justify-between gap-3">
        <Pill tone={isSupported === null ? "neutral" : isSupported ? "success" : "danger"}>
          <Lock /> {isSupported === null ? "CHECKING STORAGE" : isSupported ? "ENCRYPTED WORKSPACE" : "STORAGE UNAVAILABLE"}
        </Pill>
        <Pill tone={network === "mainnet" ? "warning" : "info"} className="uppercase">
          {network}
        </Pill>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Local Private Storage
        </p>
        <h3 className="text-2xl font-semibold tracking-tight">
          {error ? "Bills unavailable" : billCount !== null ? `${billCount} Bill${billCount === 1 ? "" : "s"}` : "Loading..."}
        </h3>
        <p className="text-xs text-muted-foreground">
          Encrypted with client AES-256-GCM. Plaintext never leaves this device.
        </p>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/50 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {needsBackup ? (
              <ShieldAlert size={14} className="text-amber-500" />
            ) : (
              <ShieldCheck size={14} className="text-teal-500" />
            )}
            Backup status
          </span>
          <span className="font-medium text-foreground">
            {!status ? "Status unavailable" : status.lastExportAt
              ? new Date(status.lastExportAt).toLocaleDateString()
              : "No backup yet"}
          </span>
        </div>
        {status?.uncoveredRecords ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {status.uncoveredRecords} record{status.uncoveredRecords === 1 ? "" : "s"} not included in last export.
          </p>
        ) : null}
      </div>

      <Link
        href="/app/settings"
        className={`${actionClass("secondary")} w-full justify-between px-4 text-xs`}
      >
        <span className="flex items-center gap-2">
          <HardDrive size={14} /> Manage backup & keys
        </span>
        <ArrowUpRight size={14} />
      </Link>
    </Panel>
  );
}
