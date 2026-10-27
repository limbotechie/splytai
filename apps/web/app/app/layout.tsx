import type { ReactNode } from "react";
import { DockShell } from "@/components/app/shell/DockShell";
import { Web3Provider } from "@/context/Web3Provider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Web3Provider>
      <DockShell>{children}</DockShell>
    </Web3Provider>
  );
}
