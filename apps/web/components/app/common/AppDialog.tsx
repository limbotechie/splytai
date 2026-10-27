"use client";

import { useRef, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { Action } from "./Primitives";
import styles from "./AppSurface.module.css";

export function AppDialog({ open, onClose, title, description, children }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className={`${styles.surface} fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col gap-5 rounded-[24px] border border-border bg-card p-5 shadow-2xl sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:p-7`}
          style={{ maxHeight: "calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))" }}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              {title ? (
                <Dialog.Title className="text-2xl font-medium tracking-tight">{title}</Dialog.Title>
              ) : (
                <Dialog.Title className="sr-only">Dialog</Dialog.Title>
              )}
              {description ? (
                <Dialog.Description className="text-sm leading-relaxed text-muted-foreground">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title ?? "Dialog"}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild><Action variant="ghost" className="size-11 shrink-0 p-0" aria-label="Close dialog"><X /></Action></Dialog.Close>
          </div>
          <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-1 pb-1 [overflow-wrap:anywhere]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
