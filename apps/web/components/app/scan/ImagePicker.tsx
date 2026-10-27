"use client";

import { Camera, ImageIcon, Loader2 } from "lucide-react";
import { useRef } from "react";
import { Panel, Action } from "../common/Primitives";

interface Props {
  busy: boolean;
  onFile: (file: File) => void;
}

export function ImagePicker({ busy, onFile }: Props) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  const handle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && !busy) onFile(file);
    event.target.value = "";
  };

  return (
    <Panel className="flex flex-col gap-6 border-dashed bg-background/40 text-center sm:p-10" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy) onFile(file); }} aria-busy={busy}>
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={handle}
        disabled={busy}
        aria-label="Take a receipt photo"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handle}
        disabled={busy}
        aria-label="Upload a receipt image"
      />
      <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-border bg-card"><Camera size={26} strokeWidth={1.5} /></div>
      <div className="space-y-2"><h2 className="text-xl font-medium tracking-tight">{busy ? "We are reading the details from your receipt." : "Choose how to add your receipt."}</h2><p className="text-sm leading-relaxed text-muted-foreground">{busy ? "Keep this page open while the receipt is processed. We will show the extracted items and totals for you to review before continuing." : "Take a photo, upload an existing image, or drag a file into this area. Make sure the item names and total are clearly visible."}</p></div>
      <button
        type="button"
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
        className="group flex min-w-0 items-center justify-between gap-3 rounded-full bg-primary p-1 ps-6 pe-1 text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
      >
        <span className="py-3 text-sm font-medium">
          {busy ? "Reading receipt…" : "Take a photo"}
        </span>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        </span>
      </button>
      <Action
        variant="secondary"
        disabled={busy}
        onClick={() => galleryRef.current?.click()}
        className="justify-between"
      >
        <span className="text-sm font-medium">Upload an image</span>
        <ImageIcon size={16} className="text-muted-foreground" />
      </Action>
      <p className="text-xs text-muted-foreground">JPEG, PNG or WebP &middot; Camera or gallery</p>
    </Panel>
  );
}
