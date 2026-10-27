"use client";
import { Marquee } from "@/components/shadcn-space/radix/animations/marquee";
import { motion } from "motion/react";
import Image from "next/image";

export interface BrandList {
  image: string;
  name: string;
  lightimg: string;
}

function BrandSlider({ brandList }: { brandList: BrandList[] }) {
  if (!brandList.length) return null;
  return (
    <section>
      <div className="py-6 md:py-10">
        <div className="mx-auto max-w-6xl">
          <motion.div 
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 1, delay: 0.6, ease: "easeInOut" }}
            className="flex flex-col gap-3"
          >
            {brandList && brandList.length > 0 && (
              <div className="py-4">
                <Marquee pauseOnHover className="[--duration:20s] p-0">
                  {brandList.map((brand, index) => (
                    <div key={index}>
                      <Image
                        src={brand.image}
                        alt={brand.name}
                        width={144}
                        height={32}
                        unoptimized
                        className="w-36 h-8 mr-6 lg:mr-20 dark:hidden"
                      />
                      <Image
                        src={brand.lightimg}
                        alt={brand.name}
                        width={144}
                        height={32}
                        unoptimized
                        className="hidden dark:block w-36 h-8 mr-12 lg:mr-20"
                      />
                    </div>
                  ))}
                </Marquee>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export default BrandSlider;
