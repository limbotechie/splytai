import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/shadcn-space/blocks/footer-01/footer";
import { SectionAnchor } from "@/components/legal/SectionAnchor";
import { TableOfContents } from "@/components/legal/TableOfContents";
import { BackToTop } from "@/components/legal/BackToTop";
import { JumpToDropdown } from "@/components/legal/JumpToDropdown";
import { ReadingProgress } from "@/components/legal/ReadingProgress";

export const metadata: Metadata = {
  title: "Privacy Policy | Splyt",
  description: "How Splyt handles encrypted browser workspaces, private request links, relay metadata, and recovery files.",
  openGraph: {
    title: "Privacy Policy | Splyt",
    description: "Understand Splyt's data handling, retention, and privacy limits.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy | Splyt",
    description: "Understand Splyt's data handling, retention, and privacy limits.",
  },
};

const sections = [
  {
    id: "introduction",
    title: "1. Scope",
    body: `Splyt helps an organiser request private reimbursements in ZEC and record receipt after checking their own wallet. It uses an accountless browser workspace and an encrypted relay, not an email account or wallet login. This policy describes that workflow and its limits.`,
  },
  {
    id: "device-storage",
    title: "2. Data on Your Device",
    body: `The browser stores workspace records in IndexedDB, using the separate splyt-private-v1 namespace and local AES-256-GCM encryption. Records can include reviewed receipts, participant labels, addresses, approved amounts, access capabilities, and payment history. Decrypted records and application encryption keys are handled in the browser.\n\nA locally persisted, non-extractable WebCrypto key protects stored records, but does not protect them from malicious same-origin scripts or someone controlling your browser profile. Splyt never imports your wallet's private keys or recovery phrase.`,
  },
  {
    id: "receipts",
    title: "3. Local Receipt Recognition",
    body: `Receipt recognition uses a browser worker with self-hosted OCR software and language assets. The image stays on your device rather than being uploaded to a hosted parser or the relay. Recognition produces suggestions that you must review and correct.\n\nThe bill contains reviewed structured details. An image you keep separately remains your responsibility. Manual entry is available when a receipt is unsupported or cannot be read reliably.`,
  },
  {
    id: "private-links",
    title: "4. Private Links and Access",
    body: `The organiser's complete bill and each participant's request are encrypted separately. A participant receives their own request and the receipt details deliberately included for it, not other participants' names, shares, reports, or keys. Access is a capability, not a verified identity.\n\nInvitation secrets are carried in the URL fragment, read in the browser, stored locally, and removed from the visible URL. Anyone holding the original private link can use its access. Forwarding it, sharing a screenshot, or copying its contents can disclose that request.`,
  },
  {
    id: "relay-data",
    title: "5. Relay Data and Metadata",
    body: `The relay stores encrypted records, opaque identifiers and grouping relationships, hashed access capabilities, signatures or public verification material, revision counters, and retention timestamps. It does not receive plaintext receipts, participant labels, amounts, receiving addresses, invitation encryption keys, or raw receipt images.\n\nEncryption does not hide all metadata. The relay can observe record sizes, grouping, request timing, and access patterns; network infrastructure can also see IP addresses. This design does not claim anonymous traffic, hidden relationships, or protection from every server rollback.`,
  },
  {
    id: "protection",
    title: "6. What Encryption Does Not Prove",
    body: `Authenticated encryption protects record contents and detects tampering when the expected record identity and revision are checked. Signed requests and confirmations authenticate the organiser's statements. They do not prove that money moved, identify a person, or establish that an allocation is fair.`,
  },
  {
    id: "retention",
    title: "7. Relay Retention",
    body: `Relay records are retained for 30 days from the last organiser update. Participant payment reports do not extend that period. Expiry applies to the bill and its child requests, and access is denied after the retention deadline.\n\nLocal workspace records and exported recovery files can outlive relay retention. An export may still be readable after remote deletion, but it cannot retrieve records that the relay no longer holds.`,
  },
  {
    id: "recovery",
    title: "8. Encrypted Recovery Files",
    body: `Recovery exports are snapshots containing local records and their application key and capability inventory. Exports use AES-GCM and a passphrase-derived key, with a fresh salt and PBKDF2-HMAC-SHA-256 at 600,000 iterations. The passphrase and plaintext keys are not exported.\n\nKeep both the file and its passphrase safe. New bills created after an export are not automatically discoverable from that older file. Restored known bills must refresh and reconcile relay revisions before further writes. Splyt cannot recover a lost passphrase or missing encryption keys.`,
  },
  {
    id: "market-rates",
    title: "9. Public Exchange Rates",
    body: `A backend adapter requests public Zcash prices from CoinGecko using a fixed coin identifier and an allowed currency code. It does not send bill identifiers, amounts, names, addresses, receipts, or participants. The provider receives the relay's rate request, not a private bill.\n\nThe organiser reviews the suggested price and timestamp before approving amounts. Published requests do not reprice. Manual ZEC entry remains available when a supported, fresh quote cannot be obtained.`,
  },
  {
    id: "wallets",
    title: "10. Wallets and Network Privacy",
    body: `Payments take place directly in participants' wallets, outside Splyt's custody. Wallet software contacts its own infrastructure and follows its own data practices. A payment QR or URI is readable by its holder; encoding a reference is not encryption.\n\nA shielded receiving address does not let Splyt control a wallet's funding inputs or guarantee the privacy of a transfer. Splyt cannot erase blockchain data, undo a transfer, or make previously public information private. No wallet-version compatibility or completed test-fund transfer is currently claimed.`,
  },
  {
    id: "deletion",
    title: "11. Clearing and Deleting Data",
    body: `Clearing the local workspace and deleting a remote bill are separate actions. Local clearing can remove keys needed to read a retained remote record. Export first if you need recovery, and do not assume that an export contains later changes.\n\nRemote deletion or revocation cannot erase information a recipient already downloaded or photographed. Cancelling a request does not stop a later transfer through a wallet. Your data-protection rights may also depend on the law that applies to the operator of a deployment.`,
  },
  {
    id: "preferences",
    title: "12. Browser Preferences and Tracking",
    body: `Browser storage also keeps local interface preferences such as the selected theme. The application does not require an account cookie, third-party advertising tracker, or analytics script. Blocking browser storage can prevent the private workspace and recovery workflow from functioning.`,
  },
  {
    id: "security-limits",
    title: "13. Security Limits and Changes",
    body: `This development software does not carry a security-audit or production-deployment claim. Encryption cannot protect against a compromised device, malicious browser extensions, or a changed application that reads decrypted data. A real-money release requires actual wallet validation and review of deployment safeguards.\n\nChanges to this policy are recorded by updating its date. No support email or external product account is presented as a verified contact channel. The documentation explains the available controls and the limits of accountless recovery.`,
  },
];

export default function PrivacyPage() {
  return (
    <>
      <ReadingProgress />
      <main className="max-w-6xl mx-auto px-4 xl:px-0 py-20">
        <div className="mb-12">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition mb-8 inline-block"
          >
            ← Back to home
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight mb-3">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: October 24, 2026</p>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <TableOfContents sections={sections} />
            </div>
          </aside>

          <div>
            <div className="lg:hidden mb-8 print:hidden">
              <JumpToDropdown sections={sections} />
            </div>

            <div className="flex flex-col gap-10">
              {sections.map(({ id, title, body }) => (
                <section key={id} id={id} className="scroll-mt-8 group rounded-lg transition-colors hover:bg-muted/30 px-4 -mx-4 py-2">
                  <h2 className="text-lg font-semibold mb-3 flex items-center">
                    {title}
                    <SectionAnchor id={id} />
                  </h2>
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line">{body}</p>
                </section>
              ))}
            </div>

            <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground flex flex-wrap gap-4 print:hidden">
              <Link href="/terms" className="hover:text-foreground transition">Terms of Service</Link>
              <Link href="/docs" className="hover:text-foreground transition">Documentation</Link>
              <Link href="/" className="hover:text-foreground transition">Home</Link>
            </div>
          </div>
        </div>
      </main>
      <BackToTop />
      <Footer />
    </>
  );
}
