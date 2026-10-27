"use client";
import Feature from "@/components/shadcn-space/blocks/feature-01/feature";
import { ClipboardCheck, Link2, ScanLine, Wallet } from "lucide-react";

const featureData = [
  {
    icon: ScanLine,
    content:
      "Receipt recognition runs in your browser, so the original image does not need to leave your device. You review the extracted items and correct any mistakes before creating payment requests.",
  },
  {
    icon: Link2,
    content:
      "Each person receives a separate private link containing their share and the details you have chosen to include. The link does not provide access to other participants' requests or payment reports.",
  },
  {
    icon: Wallet,
    content:
      "Use a compatible Zcash wallet to send the requested amount directly to the organiser. Splyt does not hold your funds, connect to your wallet account, or submit a transaction on your behalf.",
  },
  {
    icon: ClipboardCheck,
    content:
      "Participants can report when they have sent a payment, and organisers confirm receipt after checking their wallets. The two steps remain separate so the payment history reflects what has actually been acknowledged.",
  },
];

const Feature01 = () => {
  return <Feature featureData={featureData} />;
};

export default Feature01;
