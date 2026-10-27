"use client";

import Link from "next/link";
import { ArrowUpRight, ScanLine, Users, Check, Shield } from "lucide-react";
import { Greeting } from "@/components/app/home/Greeting";
import { WorkspaceCard } from "@/components/app/home/WorkspaceCard";
import { PrimaryAction } from "@/components/app/home/PrimaryAction";
import { BillList } from "@/components/app/home/BillList";
import { DraftRecoveryList } from "@/components/app/home/DraftRecoveryList";
import { Panel, Pill, actionClass } from "@/components/app/common/Primitives";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col gap-9 py-8 sm:gap-12 sm:py-12">
      <Greeting />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-8">
          <Panel className="relative flex flex-col items-start gap-7 bg-linear-to-br from-card via-card to-muted/60 sm:p-9">
            <Pill>
              <ScanLine /> CREATE A SPLIT
            </Pill>
            <div className="max-w-lg space-y-3">
              <h2 className="text-3xl leading-tight font-medium tracking-tight sm:text-4xl">
                Create a split <span className="font-serif italic">from a receipt.</span>
              </h2>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                Upload a receipt or enter items manually. Review line items, calculate ZEC shares, and generate
                independent private links with zero plaintext on the relay.
              </p>
            </div>
            <div className="w-full sm:w-auto">
              <PrimaryAction />
            </div>
            <div className="flex w-full flex-wrap gap-x-5 gap-y-3 border-t border-border/60 pt-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <ScanLine size={14} /> Local OCR scan
              </span>
              <span className="flex items-center gap-2">
                <Users size={14} /> Calculate shares
              </span>
              <span className="flex items-center gap-2">
                <Check size={14} /> Settle with private ZEC
              </span>
            </div>
          </Panel>

          <section className="min-w-0 space-y-5" aria-labelledby="recent-splits">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="recent-splits" className="text-xl font-medium tracking-tight">
                  Your hosted splits
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bills stored in your browser workspace. Follow participant requests and confirm payments.
                </p>
              </div>
              <Link href="/app/history" className={`${actionClass("ghost")} px-3 text-xs`}>
                View all <ArrowUpRight />
              </Link>
            </div>
            <BillList />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <WorkspaceCard />
          <DraftRecoveryList />
          <div className="flex items-start gap-3 px-2 text-xs leading-relaxed text-muted-foreground">
            <Shield size={16} className="mt-0.5 shrink-0 text-teal-500" />
            <p>
              Receipts and amounts are encrypted locally before sharing. The relay sees only blind ciphertext envelopes.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
