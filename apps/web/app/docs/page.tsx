import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Pill, actionClass } from "@/components/app/common/Primitives";
import Footer from "@/components/shadcn-space/blocks/footer-01/footer";

export const metadata: Metadata = {
  title: "Documentation | Splyt",
  description: "Learn how Splyt organizes browser-encrypted, private ZEC reimbursements with local OCR, shielded addresses, and manual confirmations.",
};

type Guide = {
  id: string;
  group: string;
  label: string;
  title: string;
  paragraphs: string[];
  details?: { term: string; description: string }[];
  note?: string;
};

const guides: Guide[] = [
  {
    id: "overview",
    group: "Getting started",
    label: "Overview & Architecture",
    title: "Splyt enables private reimbursements without central custody or plaintext leaks.",
    paragraphs: [
      "Splyt helps an organiser split a real-world shared bill, quote fair ZEC shares, and collect reimbursements privately. There are no accounts, email sign-ups, or wallet logins required.",
      "All receipt recognition, line item calculation, and encryption take place inside your browser. The relay server is completely blind: it holds only encrypted ciphertext envelopes, revision counters, and cryptographic hashes of access capabilities. It never sees receipts, item names, participant labels, amounts, receiving addresses, or encryption keys.",
    ],
    details: [
      {
        term: "Browser Encryption",
        description: "AES-256-GCM encryption derived in-memory via the WebCrypto API. Keys are never transmitted to the relay.",
      },
      {
        term: "Blind Relay",
        description: "Stores encrypted envelopes for up to 30 days. Rejects unauthorized reads or writes without learning plaintext.",
      },
    ],
  },
  {
    id: "shielded-zcash",
    group: "Getting started",
    label: "Shielded Zcash",
    title: "Splyt enforces shielded-only Zcash addresses for financial confidentiality.",
    paragraphs: [
      "To protect participant and organiser privacy, Splyt strictly requires shielded Zcash addresses (Sapling or Unified Addresses containing a shielded Orchard or Sapling receiver).",
      "Transparent addresses (starting with 't1' or 't3') are unconditionally rejected by the address validator. Shielded transfers protect transaction amounts and sender/receiver graph metadata on-chain.",
    ],
    note: "Splyt is not a wallet and never holds private spending keys or seed phrases. Transfers happen in your own Zcash wallet via ZIP 321 payment request URIs.",
  },
  {
    id: "receipts",
    group: "Creating a split",
    label: "Local OCR scanning",
    title: "Scan receipts locally in your browser with WebAssembly OCR.",
    paragraphs: [
      "When you scan or upload a receipt, optical character recognition runs entirely client-side using self-hosted Tesseract WebAssembly workers. Images are never uploaded to any remote server or third-party vision API.",
      "The local parser extracts merchant titles, line items, prices, subtotals, tax, tips, and totals. A human review step is mandatory: you verify and correct line items and arithmetic before generating payment requests.",
    ],
    note: "If a receipt is damaged, illegible, or on an unsupported device, you can use manual entry to input items and totals directly.",
  },
  {
    id: "participants",
    group: "Creating a split",
    label: "Participants & Allocation",
    title: "Assign shares to friendly participant names and choose an allocation method.",
    paragraphs: [
      "Add participants by friendly names or nicknames. There are no 0x Ethereum addresses or on-chain registrations required. You can choose whether you (the organiser) are participating in the bill.",
      "Splyt captures a live fiat-to-ZEC exchange rate snapshot and computes whole-bill zatoshis to guarantee that individual participant shares sum exactly to the bill total without rounding discrepancies.",
    ],
    details: [
      {
        term: "Equal Split",
        description: "Divides the bill total evenly across all active participants, with remaining zatoshis accounted for cleanly.",
      },
      {
        term: "Itemised Split",
        description: "Assigns specific items to individual participants, sharing proportional tax and tip across consumers.",
      },
      {
        term: "Custom Split",
        description: "Allows manual assignment of specific fiat amounts to each participant.",
      },
    ],
  },
  {
    id: "invites",
    group: "Sharing & Payment",
    label: "Private invite links",
    title: "URL fragments carry the content decryption key and are stripped immediately.",
    paragraphs: [
      "When a bill is published, Splyt creates an independent encrypted request for each participant. The link to each request carries the secret content key inside the URL fragment ('#v=1&r=...&s=...').",
      "Because URL fragments are never sent to web servers in HTTP requests, the relay never sees the content key. When a participant opens the link, the browser reads the fragment, saves the key to local storage, and strips the fragment from the address bar and history.",
    ],
    note: "Anyone who has the invite link can view that participant's share. Share links only with the intended recipient over a secure messaging channel.",
  },
  {
    id: "paying",
    group: "Sharing & Payment",
    label: "Wallet handoff & Reporting",
    title: "Participants pay via ZIP 321 payment URIs and report transfer details.",
    paragraphs: [
      "When a participant opens their link, their browser fetches the encrypted request envelope from the relay and decrypts it locally. It displays the owed amount in ZEC, the organiser's shielded address, and item details.",
      "Participants can scan a ZIP 321 QR code or click the 'zcash:' link to hand off the transfer to their mobile or desktop Zcash wallet (such as Zashi, Ywallet, or Zecwallet).",
      "After broadcasting the transaction, the participant can optionally submit a payment report (transaction ID and timestamp) through the encrypted relay to notify the organiser.",
    ],
  },
  {
    id: "confirmation",
    group: "Settlement",
    label: "Organiser confirmation",
    title: "Organisers verify wallet transactions and record signed confirmations.",
    paragraphs: [
      "A participant's report is an unverified statement. The organiser must check their own shielded Zcash wallet to verify that funds were genuinely received before confirming.",
      "When verified, the organiser records a signed confirmation. The confirmation stores cumulative received zatoshis, preventing replay attacks or contradictory states. The full confirmation history is retained.",
    ],
    note: "Confirmed amounts cannot be tampered with. If an organiser needs to correct a mistake, they issue a formal replacement confirmation linked to the prior record.",
  },
  {
    id: "recovery",
    group: "Workspace management",
    label: "Backup & Recovery",
    title: "Export passphrase-protected backup files to protect your private workspace.",
    paragraphs: [
      "Because Splyt has no accounts or central database of plaintext records, your bills, participant keys, and edit capabilities live in your browser's IndexedDB.",
      "Export an encrypted workspace backup periodically from the Settings screen. The export is protected by an AES-GCM key derived from your chosen passphrase.",
      "When importing a backup into a new browser, Splyt reconciles all restored records with the relay write-gate to ensure fresh sync receipts before accepting new edits.",
    ],
  },
];

export default function DocsPage() {
  const groups = Array.from(new Set(guides.map((g) => g.group)));

  return (
    <>
      <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 md:py-20 flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition inline-block"
          >
            &larr; Back to home
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <Pill tone="info">
                <ShieldCheck size={13} /> Private ZEC Reimbursement Guide
              </Pill>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Splyt Documentation
              </h1>
            </div>
            <Link href="/app/scan" className={actionClass("primary")}>
              Start a split <ArrowUpRight size={15} />
            </Link>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Splyt combines client-side WebCrypto encryption, self-hosted WebAssembly OCR, and shielded Zcash
            settlement. This guide details how bills are processed, shared, paid, and confirmed.
          </p>
        </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Navigation Sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-6 text-sm">
            {groups.map((group) => (
              <div key={group} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </h2>
                <ul className="space-y-1 border-l border-border/60 pl-3">
                  {guides
                    .filter((g) => g.group === group)
                    .map((guide) => (
                      <li key={guide.id}>
                        <a
                          href={`#${guide.id}`}
                          className="block py-1 text-xs text-muted-foreground transition hover:text-foreground"
                        >
                          {guide.label}
                        </a>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Guides Content */}
        <div className="min-w-0 space-y-12">
          {guides.map((guide) => (
            <section
              key={guide.id}
              id={guide.id}
              className="scroll-mt-24 space-y-4 rounded-[28px] border border-border/70 bg-background/50 p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral" className="text-[11px]">
                  {guide.group}
                </Pill>
                <span className="text-xs text-muted-foreground">&middot;</span>
                <span className="text-xs font-medium text-foreground">{guide.label}</span>
              </div>

              <h2 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                {guide.title}
              </h2>

              <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                {guide.paragraphs.map((p, idx) => (
                  <p key={idx}>{p}</p>
                ))}
              </div>

              {guide.details && guide.details.length > 0 && (
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  {guide.details.map((d, idx) => (
                    <div
                      key={idx}
                      className="rounded-[20px] border border-border/60 bg-muted/30 p-4"
                    >
                      <h3 className="text-xs font-semibold text-foreground">{d.term}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {guide.note && (
                <div className="rounded-[20px] bg-primary/5 border border-primary/20 p-4 text-xs leading-relaxed text-foreground">
                  <span className="font-semibold text-primary">Note: </span>
                  {guide.note}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
    <Footer />
  </>
  );
}
