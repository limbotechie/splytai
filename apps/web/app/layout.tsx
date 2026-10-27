import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Self-hosted (latin subsets) so dev/build never depends on fonts.googleapis.com
// or fonts.gstatic.com, which are unreachable in some environments. Files are the
// same font binaries Next.js downloads for the Google Fonts loader.
const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-mono",
  weight: "100 900",
});

const instrumentSerif = localFont({
  src: [
    {
      path: "./fonts/instrument-serif-latin.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/instrument-serif-italic-latin.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Splyt",
  description: "Organise private ZEC reimbursement requests. Review receipts in your browser and record payments after checking your own wallet.",
  referrer: "no-referrer",
  openGraph: {
    title: "Splyt",
    description: "Private reimbursement requests with browser-local receipt review and manual payment confirmation.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Splyt",
    description: "Private reimbursement requests with browser-local receipt review and manual payment confirmation.",
  },
  icons: {
    icon: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
