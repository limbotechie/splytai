"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { PlusIcon } from "lucide-react";

const FAQ_DATA = [
  {
    question: "Who can read a bill or a private request?",
    answer:
      "The organiser keeps the complete bill in an encrypted browser workspace. Each private link opens only its own request and included receipt details; anyone holding that link has its access. The relay stores encrypted records, not their readable contents.",
  },
  {
    question: "Does Splyt connect to my wallet or hold funds?",
    answer:
      "No wallet account is connected to Splyt. Participants send ZEC directly to the organiser through their own wallet, which handles the transfer and fees. Splyt does not hold funds, import keys, or submit transactions.",
  },
  {
    question: "How is a payment confirmed?",
    answer:
      "Participants can report when they have sent a payment, and organisers confirm receipt after checking their wallets. A report is not proof of payment, and an organiser's confirmation records their acknowledgement rather than an independent blockchain verification.",
  },
  {
    question: "Can I recover my workspace without an account?",
    answer:
      "There is no account or password reset. Keep an encrypted recovery file and its passphrase safe, and export again after creating new bills. A backup is a snapshot; it cannot discover bills or keys created after that export.",
  },
  {
    question: "Does a shielded address make every transfer private?",
    answer:
      "Splyt accepts supported shielded-only receiving addresses, but cannot control a wallet's inputs or guarantee transaction privacy. Wallet compatibility testing remains incomplete. Read the wallet requirements before testing a handoff; real-money use requires validation with an actual wallet.",
  },
];

const AnimatedItem = ({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) => {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.5, once: false });

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.7, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
      transition={{ duration: 0.2, delay }}
    >
      {children}
    </motion.div>
  );
};

export default function Faq() {
  return (
    <section id="faq">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20 lg:py-24 flex flex-col gap-16">
        <div className="flex flex-col gap-4 items-center animate-in fade-in slide-in-from-top-10 duration-1000 delay-100 ease-in-out fill-mode-both">
          <Badge
            variant="outline"
            className="text-sm h-auto py-1 px-3 border-0 outline outline-border"
          >
            FAQs
          </Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-center max-w-lg">
            Understand what stays private and what you need to check.
          </h2>
        </div>
        <Accordion type="single" collapsible className="w-full flex flex-col gap-6">
          {FAQ_DATA.map((faq, index) => (
            <AnimatedItem key={`item-${index}`} delay={index * 0.1}>
              <AccordionItem
                value={`item-${index}`}
                className="p-6 border border-border rounded-2xl flex flex-col gap-3 group/item data-[state=open]:bg-accent transition-colors"
              >
                <AccordionTrigger className="p-0 text-xl font-medium hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden cursor-pointer">
                  {faq.question}
                  <PlusIcon className="w-6 h-6 shrink-0 transition-transform duration-200 group-aria-expanded/accordion-trigger:rotate-45" />
                </AccordionTrigger>
                <AccordionContent className="p-0 text-muted-foreground text-base">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            </AnimatedItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
