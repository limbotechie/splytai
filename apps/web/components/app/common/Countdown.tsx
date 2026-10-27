"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { formatCountdown } from "@/lib/format";
import { Pill } from "./Primitives";

export function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = expiresAt - now;
  const expired = remaining <= 0;

  return (
    <Pill tone={expired ? "warning" : "neutral"} className="tabular-nums">
      <Timer size={12} />
      {formatCountdown(remaining)}
    </Pill>
  );
}
