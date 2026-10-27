import Link from "next/link";
import { BookOpen, Shield } from "lucide-react";
import { Separator } from "@/components/ui/separator";

type FooterSection = {
  title: string;
  links: { title: string; href: string }[];
};

const footerSections: FooterSection[] = [
  {
    title: "Product",
    links: [
      { title: "How it works", href: "/#how-it-works" },
      { title: "The workflow", href: "/#workflow" },
      { title: "Docs", href: "/docs" },
    ],
  },
  {
    title: "Legal",
    links: [
      { title: "Terms of Service", href: "/terms" },
      { title: "Privacy Policy", href: "/privacy" },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="relative py-10 overflow-hidden before:absolute before:w-3/4 before:h-full before:bg-linear-to-r before:from-sky-100 before:via-white before:to-amber-100 before:rounded-full before:top-0 before:left-1/2 before:-translate-x-1/2 before:blur-3xl before:-z-10 before:opacity-60 dark:before:from-slate-800 dark:before:via-black dark:before:to-stone-700">
      <div className="max-w-7xl xl:px-16 lg:px-8 px-4 mx-auto">
        <div className="flex flex-col gap-6 sm:gap-12">
          <div className="py-12 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 lg:grid-cols-12 gap-x-8 gap-y-10 px-6 xl:px-0">
            <div className="col-span-full lg:col-span-4">
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-100 ease-in-out fill-mode-both">
                <Link href="/" aria-label="Splyt home" className="text-xl font-semibold tracking-tight">
                  splyt.
                </Link>
                <p className="text-base font-normal text-muted-foreground">
                  Splyt helps people organise private payment requests for shared
                  expenses. Transfers take place in their own wallets, and
                  payment confirmations are recorded by the organiser.
                </p>
                <div className="flex items-center gap-4">
                  <Link href="/docs" aria-label="Read the documentation" className="text-muted-foreground hover:text-foreground">
                    <BookOpen size={20} aria-hidden="true" />
                  </Link>
                  <Link href="/privacy" aria-label="Read the privacy policy" className="text-muted-foreground hover:text-foreground">
                    <Shield size={20} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="col-span-1 lg:block hidden" />

            {footerSections.map(({ title, links }, index) => (
              <div key={index} className="col-span-2">
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-100 ease-in-out fill-mode-both">
                  <p className="text-base font-medium text-foreground">{title}</p>
                  <ul className="flex flex-col gap-3">
                    {links.map(({ title, href }) => (
                      <li key={title}>
                        <Link href={href} className="text-base font-normal text-muted-foreground hover:text-foreground">
                          {title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            <div className="col-span-3">
              <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-100 ease-in-out fill-mode-both">
                <p className="text-base font-medium text-foreground">Get started</p>
                <ul className="flex flex-col gap-3">
                  <li>
                    <Link
                      href="/app/scan"
                      className="text-base font-normal text-muted-foreground hover:text-foreground"
                    >
                      Start a private bill
                    </Link>
                  </li>
                  <li>
                    <Link href="/docs#wallets" className="text-base font-normal text-muted-foreground hover:text-foreground">
                      Wallet requirements
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <Separator orientation="horizontal" />
          <p className="text-sm font-normal text-muted-foreground text-center animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-100 ease-in-out fill-mode-both">
            &copy; 2026 Splyt.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
