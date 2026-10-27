import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrCopy } from "./share";

afterEach(() => vi.unstubAllGlobals());

describe("shareOrCopy", () => {
  it("reports sharing only after the native share completes", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    expect(await shareOrCopy({ title: "Split", url: "https://example.test/pay" })).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not copy a link when the user cancels sharing", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")), clipboard: { writeText } });
    expect(await shareOrCopy({ title: "Split", text: "Reminder" })).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the message and link when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareOrCopy({ title: "Split", text: "Your share", url: "https://example.test/pay" })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Your share\nhttps://example.test/pay");
  });

  it("falls back to copying when native sharing fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new Error("Unsupported")), clipboard: { writeText } });
    expect(await shareOrCopy({ title: "Split", text: "Reminder" })).toBe("copied");
  });

  it("propagates clipboard errors instead of reporting false success", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
    await expect(shareOrCopy({ title: "Split", text: "Reminder" })).rejects.toThrow("Permission denied");
  });
});
