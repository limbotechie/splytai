"use client";

import { PageHeader, Pill } from "@/components/app/common/Primitives";
import { ShieldCheck } from "lucide-react";

export function Greeting() {
  return (
    <PageHeader
      eyebrow="Your dashboard"
      title={
        <>
          Manage your <span className="font-serif italic">shared bills.</span>
        </>
      }
      description="Create private splits from receipts, generate independently encrypted payment links, and track ZEC reimbursements in your browser's encrypted workspace."
      action={
        <Pill tone="success">
          <ShieldCheck /> Private ZEC splits
        </Pill>
      }
    />
  );
}
