import HeroSection from "@/components/shadcn-space/radix/blocks/hero-01/hero";
import type { NavigationSection } from "@/components/shadcn-space/radix/blocks/hero-01/header";
import Header from "@/components/shadcn-space/radix/blocks/hero-01/header";

export default function AgencyHeroSection() {
  const navigationData: NavigationSection[] = [
    { title: "Home", href: "/#hero", isActive: true },
    { title: "How it works", href: "/#how-it-works" },
    { title: "Workflow", href: "/#workflow" },
    { title: "FAQ", href: "/#faq" },
  ];

  return (
    <div className="relative">
      <Header navigationData={navigationData} />
      <main>
        <HeroSection />
      </main>
    </div>
  );
}
