import AgencyHeroSection from "@/components/shadcn-space/radix/blocks/hero-01";
import Feature01 from "@/components/shadcn-space/blocks/feature-01";
import AboutAndStats01 from "@/components/shadcn-space/blocks/about-us-01";
import Faq from "@/components/shadcn-space/blocks/faq-01/faq";
import Footer from "@/components/shadcn-space/blocks/footer-01/footer";

export default function Page() {
  return (
    <>
      <AgencyHeroSection />
      <Feature01 />
      <AboutAndStats01 />
      <Faq />
      <Footer />
    </>
  );
}
