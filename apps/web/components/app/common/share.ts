export async function shareOrCopy(data: { title: string; text?: string; url?: string }): Promise<"shared" | "copied" | "cancelled"> {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard.writeText([data.text, data.url].filter(Boolean).join("\n"));
  return "copied";
}
