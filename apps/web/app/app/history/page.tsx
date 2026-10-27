"use client";

import { ArrowUpRight, Search, Clock, Users, Receipt, Archive } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DraftRecoveryList } from "@/components/app/home/DraftRecoveryList";
import { listLocalBills } from "@/lib/workflow/bill";
import type { LocalRecord } from "@/lib/private-workspace/storage";
import type { LocalBill } from "@/lib/bills/types";
import { formatZec } from "@/lib/bills/money";
import { cn } from "@/lib/utils";
import { PageHeader, Panel, Pill, StatePanel, actionClass } from "@/components/app/common/Primitives";

type BillFilter = "all" | "active" | "archived";

const FILTER_TABS: { label: string; value: BillFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
];

export default function HistoryPage() {
  const [bills, setBills] = useState<LocalRecord<LocalBill>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    listLocalBills()
      .then((records) => {
        if (active) {
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

  const filteredBills = useMemo(() => {
    if (!bills) return [];
    return bills.filter(({ value: bill }) => {
      const isArchived = bill.manifest.status === "archived";
      if (filter === "active" && isArchived) return false;
      if (filter === "archived" && !isArchived) return false;

      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const titleMatch = bill.manifest.title.toLowerCase().includes(query);
        const billIdMatch = bill.manifest.billId.toLowerCase().includes(query);
        const participantMatch = bill.manifest.participants.some((p) =>
          p.label.toLowerCase().includes(query)
        );
        if (!titleMatch && !billIdMatch && !participantMatch) return false;
      }

      return true;
    });
  }, [bills, filter, search]);

  return (
    <div className="flex flex-1 flex-col gap-9 py-8 sm:py-12">
      <PageHeader
        eyebrow="Split history"
        title={
          <>
            Review the bills <span className="font-serif italic">you have hosted.</span>
          </>
        }
        description="Check reimbursement progress, open previous splits, or inspect encrypted records in your local browser workspace."
        action={
          <Link href="/app/scan" className={actionClass()}>
            New split <ArrowUpRight />
          </Link>
        }
      />

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-5" aria-label="Hosted splits">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex flex-wrap gap-1 rounded-[24px] border border-border/70 bg-muted/40 p-1.5 sm:w-fit sm:rounded-full"
              aria-label="Filter hosted splits"
            >
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setFilter(tab.value)}
                  aria-pressed={filter === tab.value}
                  className={cn(
                    "min-h-11 flex-1 rounded-full px-4 py-2 text-sm transition sm:flex-none sm:px-6",
                    filter === tab.value
                      ? "bg-background text-foreground shadow-xs font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search bills or people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-full border border-border/70 bg-background/50 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {error ? (
            <StatePanel
              title="Could not open workspace bills"
              description={error}
              tone="danger"
            />
          ) : bills === null ? (
            <StatePanel
              title="Loading your hosted splits..."
              description="Decrypting workspace records from IndexedDB."
              busy
            />
          ) : filteredBills.length === 0 ? (
            <StatePanel
              title={
                search.trim()
                  ? "No matching splits found"
                  : filter === "archived"
                  ? "No archived splits"
                  : "No hosted splits found"
              }
              description={
                search.trim()
                  ? `No bills matched "${search}". Try clearing your search query.`
                  : filter === "archived"
                  ? "Archived splits will appear here when you archive completed bills."
                  : "Scan a receipt or enter items manually to host your first private reimbursement request."
              }
              action={
                search.trim() || filter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                    className={actionClass("secondary")}
                  >
                    Clear filters
                  </button>
                ) : (
                  <Link href="/app/scan" className={actionClass("primary")}>
                    Create a split
                  </Link>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredBills.map(({ value: bill }) => {
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
          )}
        </section>

        <aside className="min-w-0 space-y-6">
          <DraftRecoveryList />
          <Panel className="space-y-3">
            <h2 className="font-medium">Private Browser Storage</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Bills hosted from this browser are encrypted and stored in your device&apos;s IndexedDB.
              The relay only sees blind ciphertext envelopes and revision counters. No receipt data or keys
              ever leave your browser unencrypted.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
