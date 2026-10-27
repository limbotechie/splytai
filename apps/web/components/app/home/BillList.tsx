"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Receipt, Users, Clock, Archive } from "lucide-react";
import { listLocalBills } from "@/lib/workflow/bill";
import type { LocalRecord } from "@/lib/private-workspace/storage";
import type { LocalBill } from "@/lib/bills/types";
import { formatZec } from "@/lib/bills/money";
import { Panel, Pill, StatePanel, actionClass } from "@/components/app/common/Primitives";

export function BillList() {
  const [bills, setBills] = useState<LocalRecord<LocalBill>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listLocalBills()
      .then((records) => {
        if (active) {
          // Sort newest first
          const sorted = [...records].sort((a, b) => {
            const timeA = Date.parse(a.value.manifest.createdAt || "0");
            const timeB = Date.parse(b.value.manifest.createdAt || "0");
            return timeB - timeA;
          });
          setBills(sorted);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load bills.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <StatePanel
        title="Could not open workspace bills"
        description={error}
        tone="danger"
      />
    );
  }

  if (bills === null) {
    return (
      <StatePanel
        title="Loading your hosted splits..."
        description="Decrypting workspace records from IndexedDB."
        busy
      />
    );
  }

  if (bills.length === 0) {
    return (
      <StatePanel
        title="No hosted splits yet"
        description="Scan a receipt or enter items manually to create your first private reimbursement request."
        action={
          <Link href="/app/scan" className={actionClass("primary")}>
            Create your first split
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {bills.slice(0, 5).map(({ value: bill }) => {
        const manifest = bill.manifest;
        const participantCount = manifest.participants.length;
        const totalZatoshis = BigInt(manifest.conversion.wholeBillZatoshis);
        const isArchived = manifest.status === "archived";

        return (
          <Link
            key={manifest.billId}
            href={`/app/bills/${manifest.billId}`}
            className="group block min-w-0"
          >
            <Panel className="flex flex-col justify-between gap-4 transition-all duration-200 hover:border-primary/40 hover:bg-muted/40 sm:flex-row sm:items-center">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <h3 className="truncate text-base font-medium tracking-tight text-foreground group-hover:text-primary">
                    {manifest.title}
                  </h3>
                  {isArchived ? (
                    <Pill tone="neutral" className="py-0 px-2 text-[10px]">
                      <Archive size={11} /> Archived
                    </Pill>
                  ) : (
                    <Pill tone="success" className="py-0 px-2 text-[10px]">
                      Active
                    </Pill>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users size={13} /> {participantCount} person{participantCount === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock size={13} /> {new Date(manifest.createdAt).toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Receipt size={13} /> {manifest.receipt.currency} {(Number(manifest.receipt.totalMinor) / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-right">
                  <p className="text-base font-semibold tracking-tight text-foreground font-mono">
                    {formatZec(totalZatoshis)} ZEC
                  </p>
                  <p className="text-[11px] text-muted-foreground uppercase">
                    {manifest.receiving.network}
                  </p>
                </div>
                <ArrowUpRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
              </div>
            </Panel>
          </Link>
        );
      })}
    </div>
  );
}
