import { describe, it, expect, vi, beforeEach } from "vitest";

const ext = vi.hoisted(() => ({ loadStreamLabels: vi.fn() }));
vi.mock("../extensions/streamLabels", () => ext);

import { getStreamLabels, resetStreamLabels, NO_STREAM_LABELS } from "./streamLabels";

describe("[SLBL] getStreamLabels", () => {
  beforeEach(() => {
    resetStreamLabels();
    ext.loadStreamLabels.mockReset();
  });

  it("[SLB1] returns the extension's resolver, loaded once per platform", async () => {
    const resolver = (id: string) => (id === "a" ? "Label A" : null);
    ext.loadStreamLabels.mockResolvedValue(resolver);
    const first = await getStreamLabels("https://core.test/service/info");
    const second = await getStreamLabels("https://core.test/service/info");
    expect(first("a")).toBe("Label A");
    expect(second).toBe(first);
    expect(ext.loadStreamLabels).toHaveBeenCalledTimes(1);
    expect(ext.loadStreamLabels).toHaveBeenCalledWith("https://core.test/service/info");
  });

  it("[SLB2] reloads for another platform", async () => {
    ext.loadStreamLabels.mockResolvedValue(NO_STREAM_LABELS);
    await getStreamLabels("https://a.test/service/info");
    await getStreamLabels("https://b.test/service/info");
    expect(ext.loadStreamLabels).toHaveBeenCalledTimes(2);
  });

  it("[SLB3] never rejects: a failing extension yields no labels", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ext.loadStreamLabels.mockRejectedValue(new Error("model unavailable"));
    const r = await getStreamLabels("https://core.test/service/info");
    expect(r).toBe(NO_STREAM_LABELS);
    warn.mockRestore();
  });

  it("[SLB4] a non-function answer is treated as no labels", async () => {
    ext.loadStreamLabels.mockResolvedValue(undefined);
    expect(await getStreamLabels("https://core.test/service/info")).toBe(NO_STREAM_LABELS);
  });

  it("[SLB5] the default extension knows no labels", async () => {
    const real = await vi.importActual<typeof import("../extensions/streamLabels")>(
      "../extensions/streamLabels",
    );
    const r = await real.loadStreamLabels("https://core.test/service/info");
    expect(r("anything")).toBeNull();
  });
});
