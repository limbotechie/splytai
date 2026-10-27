"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

interface Props {
  expiresAt: number;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function ExpiryBanner({ expiresAt }: Props) {
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining > TEN_MINUTES_MS) return null;
  if (remaining <= 0) return null;

  const minutes = Math.max(1, Math.ceil(remaining / 60000));

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[24px] border border-orange-500/20 bg-orange-500/10 p-5 text-sm text-orange-800 dark:text-orange-300"
    >
      <Timer size={18} className="mt-0.5 shrink-0" />
      <div className="space-y-1"><p className="font-medium">This payment window ends in about {minutes} minute{minutes === 1 ? "" : "s"}.</p><p className="text-xs leading-relaxed opacity-80">Participants need to complete their payments before the deadline. Share their individual links if they have not received them yet.</p></div>
    </div>
  );
}
