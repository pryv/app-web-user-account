// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const ext = vi.hoisted(() => ({ loadStreamLabels: vi.fn() }));
vi.mock("../extensions/streamLabels", () => ext);

import { useRequestingApp, useStreamLabels } from "./useConsentDisplay";
import { resetStreamLabels } from "./streamLabels";
import { resetAppCatalog } from "./appCatalog";
import { _setDeployedSettingsForTest } from "./deployedSettings";

const SVC = "https://core.test/service/info";

describe("[UCDH] consent display hooks", () => {
  beforeEach(() => {
    resetStreamLabels();
    resetAppCatalog();
    ext.loadStreamLabels.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    _setDeployedSettingsForTest(null);
  });

  it("[UCD1] useStreamLabels starts empty, then swaps in the extension's resolver", async () => {
    ext.loadStreamLabels.mockResolvedValue((id: string) => (id === "weight" ? "Body weight" : null));
    const { result } = renderHook(() => useStreamLabels(SVC));
    expect(result.current("weight")).toBeNull();
    await waitFor(() => expect(result.current("weight")).toBe("Body weight"));
    expect(result.current("other")).toBeNull();
  });

  it("[UCD2] useStreamLabels loads nothing without a platform", () => {
    const { result } = renderHook(() => useStreamLabels(null));
    expect(result.current("weight")).toBeNull();
    expect(ext.loadStreamLabels).not.toHaveBeenCalled();
  });

  it("[UCD3] useRequestingApp resolves a catalogued id to its curated identity", async () => {
    _setDeployedSettingsForTest({ appCatalogUrl: "https://assets.test/apps/list.json" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            apps: [{ id: "diary-app", name: "Diary", description: { en: "Keeps a diary" }, icon: { type: "emoji", value: "📓" } }],
          }),
        ),
      ),
    );
    const { result } = renderHook(() => useRequestingApp("diary-app", SVC));
    await waitFor(() =>
      expect(result.current).toEqual({
        name: "Diary",
        description: "Keeps a diary",
        icon: { type: "emoji", value: "📓" },
      }),
    );
  });

  it("[UCD4] useRequestingApp stays null for an unknown id or no catalog", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRequestingApp("diary-app", SVC));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
