"use client";
import AboutUs from "@/components/shadcn-space/blocks/about-us-01/about-us";
import { ClipboardCheck, LockKeyhole, ScanLine } from "lucide-react";

const aboutusData = [
  {
    icon: ScanLine,
    title: "Local receipts",
    color: "bg-blue-500/10 text-blue-500",
  },
  {
    icon: LockKeyhole,
    title: "Private requests",
    color: "bg-teal-400/10 text-teal-400",
  },
  {
    icon: ClipboardCheck,
    title: "Your confirmation",
    color: "bg-orange-400/10 text-orange-400",
  },
];

const workflowSteps = [
  {
    title: "Review the receipt and shares",
    step: "01",
  },
  {
    title: "Approve and share private requests",
    step: "02",
  },
  {
    title: "Check your wallet and record receipt",
    step: "03",
  },
];

const AboutAndStats01 = () => {
  return <AboutUs aboutusData={aboutusData} workflowSteps={workflowSteps} />;
};

export default AboutAndStats01;
