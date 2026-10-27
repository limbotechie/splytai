import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { LockKeyhole, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";

type Features = {
  icon: LucideIcon;
  content: string;
}[];

const Feature = ({ featureData }: { featureData: Features }) => {
  return (
    <section id="how-it-works">
      <div className="py-16 md:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 md:gap-12">
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.8,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="flex flex-col items-center justify-center gap-4"
            >
              <div className="flex flex-col gap-4 max-w-full items-center text-center md:max-w-xl">
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight">
                  Keep each person&apos;s request private.
                </h2>
                <p className="text-base font-normal text-muted-foreground">
                  Shared expenses should be easy to organise without exposing the
                  details to everyone involved. Splyt gives each participant the
                  information they need while keeping the complete bill in the
                  organiser&apos;s private workspace.
                </p>
              </div>
            </motion.div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-6">
              <motion.div
                initial={{ x: -100, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.8,
                  ease: [0.21, 0.47, 0.32, 0.98],
                }}
                className="relative overflow-hidden p-6 sm:p-16 rounded-2xl bg-[#e9e6d7] h-full w-full"
              >
                <svg viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
                  <path d="M0 240C130 180 260 335 390 260S540 180 600 220V700H0Z" fill="#c6ceb5" />
                  <path d="M0 375C150 245 300 410 440 325S560 340 600 300V700H0Z" fill="#82947b" />
                  <path d="M0 540C150 390 250 570 410 435S560 435 600 460V700H0Z" fill="#445847" />
                </svg>
                <Card className="relative flex items-start gap-12 has-data-[slot=card-footer]:pb-6! sm:has-data-[slot=card-footer]:pb-10! pt-6 sm:py-10 border-none shadow-none ring-0 rounded-lg">
                  <CardContent className="flex flex-col gap-6 px-6 sm:px-8">
                    <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                      <LockKeyhole size={22} strokeWidth={1.5} />
                    </span>
                    <h3 className="text-xl sm:text-2xl font-medium">
                      Your workspace is stored in this browser, and Splyt does
                      not have an account it can restore for you. Keep an
                      encrypted recovery file somewhere safe and update it when
                      you create new bills.
                    </h3>
                  </CardContent>
                  <CardFooter className="bg-card border-none w-full px-6 sm:px-8 py-0 flex flex-col items-start gap-0.5">
                    <p className="text-sm font-medium text-primary">
                      YOUR BROWSER WORKSPACE
                    </p>
                    <span className="text-xs font-normal text-muted-foreground uppercase">
                      Keep an encrypted recovery file
                    </span>
                  </CardFooter>
                </Card>
              </motion.div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-6">
                {featureData?.map((value, index) => {
                  return (
                    <motion.div
                      key={index}
                      initial={{ x: 100, opacity: 0 }}
                      whileInView={{ x: 0, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{
                        duration: 0.8,
                        ease: [0.21, 0.47, 0.32, 0.98],
                      }}
                    >
                      <Card className="py-8 bg-muted ring-0 border-0 h-full">
                        <CardContent className="w-full h-full px-8 flex flex-col items-start gap-12 justify-between">
                          <value.icon
                            className="w-6 h-6 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <p className="text-base text-primary font-normal">
                            {value?.content}
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Feature;
