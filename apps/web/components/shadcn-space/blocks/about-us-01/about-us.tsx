"use client"

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

type aboutusData = {
  icon: LucideIcon;
  title: string;
  color: string;
}[];

type WorkflowStep = {
  title: string;
  step: string;
}[];

const AboutUs = ({
  aboutusData,
  workflowSteps,
}: {
  aboutusData: aboutusData;
  workflowSteps: WorkflowStep;
}) => {
  return (
    <section id="workflow" className="py-16 md:py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center gap-8 md:gap-16">
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.8,
              ease: [0.21, 0.47, 0.32, 0.98],
            }}
            className="flex flex-col items-center justify-center gap-4"
          >
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-medium text-foreground text-center tracking-tight">
              Three steps from a receipt to recorded reimbursements.
            </h2>
            <p className="max-w-2xl text-center text-base font-normal text-muted-foreground">
              Review the receipt and decide how the cost should be shared.
              Approve the ZEC amounts, send each participant a private request,
              and record reimbursements as they arrive in your wallet.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-4">
              {aboutusData.map((item, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center gap-3 px-6 py-2 rounded-full",
                    item.color
                  )}
                >
                  <item.icon className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10" aria-hidden="true" />
                  <span
                    className={cn(
                      "text-4xl font-normal font-serif italic"
                    )}
                  >
                    {item.title}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
          <div
            className="w-full grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-0"
          >
            {workflowSteps.map((value, index) => {
              return (
                <div
                  key={index}
                  className="relative px-6 py-5 sm:py-10 gap-3 flex flex-col items-center justify-center"
                >
                  {index !== 0 && (
                    <div className="hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 w-px h-40 bg-border" />
                  )}
                  <div className="flex gap-0 sm:gap-2 text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-medium">
                    <span><span className="sr-only">Step </span>{value.step}</span>
                  </div>
                  <p className="text-base font-normal text-muted-foreground text-center">
                    {value.title}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutUs;
