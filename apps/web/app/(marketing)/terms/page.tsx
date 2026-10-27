import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/shadcn-space/blocks/footer-01/footer";
import { SectionAnchor } from "@/components/legal/SectionAnchor";
import { termsSections, estimateReadingTime } from "@/lib/terms-sections";
import { TableOfContents } from "@/components/legal/TableOfContents";
import { BackToTop } from "@/components/legal/BackToTop";
import { JumpToDropdown } from "@/components/legal/JumpToDropdown";
import { ReadingProgress } from "@/components/legal/ReadingProgress";

const readingTime = estimateReadingTime(termsSections);

export const metadata: Metadata = {
  title: "Terms of Service | Splyt",
  description: "Responsibilities and limits for private reimbursement requests, wallet handoff, manual confirmations, and accountless recovery.",
  openGraph: {
    title: "Terms of Service | Splyt",
    description: "Understand the responsibilities and limits of using Splyt.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Terms of Service | Splyt",
    description: "Understand the responsibilities and limits of using Splyt.",
  },
};


export default function TermsPage() {
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
          <h1 className="text-4xl font-semibold tracking-tight mb-3">Terms of Service</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">
              Last updated: October 24, 2026
            </span>
            <span>·</span>
            <span>{termsSections.length} sections</span>
            <span>·</span>
            <span>{readingTime} min read</span>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-8">
              <TableOfContents sections={termsSections} />
            </div>
          </aside>

          <div>
            <div className="lg:hidden mb-8 print:hidden">
              <JumpToDropdown sections={termsSections} />
            </div>

            <div className="flex flex-col divide-y divide-border">
              {termsSections.map(({ id, title, body }) => (
                <section key={id} id={id} className="py-8 scroll-mt-8 group rounded-lg transition-colors hover:bg-muted/30 px-4 -mx-4">
                  <h2 className="text-lg font-semibold mb-3 flex items-center">
                    {title}
                    <SectionAnchor id={id} />
                  </h2>
                  <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-line">{body}</p>
                </section>
              ))}
            </div>

            <div className="mt-16 pt-8 border-t border-border text-sm text-muted-foreground flex flex-wrap gap-4 print:hidden">
              <Link href="/privacy" className="hover:text-foreground transition">Privacy Policy</Link>
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
