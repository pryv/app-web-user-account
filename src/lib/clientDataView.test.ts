// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * [CDVW] Client data as rows: flattened to dotted paths down to three
 * segments, lists of plain values, a raw view for the rest, the consent
 * message left out, URL credentials masked; labels from the extension, then
 * the built-in table, then the path.
 */

const ext = vi.hoisted(() => ({ label: (_path: string): string | null => null }));
vi.mock("../extensions/clientDataLabels", () => ({
  clientDataLabel: (path: string) => ext.label(path),
}));

import { clientDataRows, MAX_INLINE_CHARS } from "./clientDataView";
import { clientDataLabel } from "./clientDataLabels";

afterEach(() => {
  ext.label = () => null;
});

describe("[CDVW] clientDataRows", () => {
  it("[CDV1] flattens plain objects to dotted paths, down to depth 3", () => {
    const rows = clientDataRows({
      appId: "diary",
      oauth: { client: { name: "Clinic", host: "clinic.example", deep: { x: 1 } }, dataGrantId: "g1" },
    });
    expect(rows).toEqual([
      { path: "appId", value: "diary" },
      { path: "oauth.client.name", value: "Clinic" },
      { path: "oauth.client.host", value: "clinic.example" },
      { path: "oauth.client.deep", value: { raw: { x: 1 } } },
      { path: "oauth.dataGrantId", value: "g1" },
    ]);
  });

  it("[CDV2] arrays of plain values are lists; arrays of objects and long strings are raw; an empty object is none", () => {
    const long = "x".repeat(MAX_INLINE_CHARS + 1);
    const rows = clientDataRows({ tags: ["a", 2, true], items: [{ a: 1 }], note: long, empty: {}, none: null, n: 3 });
    expect(rows).toEqual([
      { path: "tags", value: ["a", "2", "true"] },
      { path: "items", value: { raw: [{ a: 1 }] } },
      { path: "note", value: { raw: long } },
      { path: "empty", value: null },
      { path: "none", value: null },
      { path: "n", value: "3" },
    ]);
  });

  it("[CDV3] the consent message key is left out (its own block renders it)", () => {
    const rows = clientDataRows({ "app-web-auth:description": { type: "note/txt", content: "hi" }, appId: "x" });
    expect(rows.map((r) => r.path)).toEqual(["appId"]);
  });

  it("[CDV4] URL credentials are masked, in rows and in raw views", () => {
    const rows = clientDataRows({
      cmc: {
        counterparty: { username: "alice", apiEndpoint: "https://c3x9tok3n@core.example.com/alice/" },
        backChannelApiEndpoint: "https://bk7tok3n@core.example.com/alice/",
      },
      list: [{ url: "https://l1st0k@core.example.com/" }],
    });
    expect(rows).toContainEqual({ path: "cmc.counterparty.apiEndpoint", value: "https://***@core.example.com/alice/" });
    expect(rows).toContainEqual({ path: "cmc.backChannelApiEndpoint", value: "https://***@core.example.com/alice/" });
    const text = JSON.stringify(rows);
    for (const token of ["c3x9tok3n", "bk7tok3n", "l1st0k"]) expect(text).not.toContain(token);
  });

  it("[CDV5] nothing to show for null, a non-object, or an empty object", () => {
    expect(clientDataRows(null)).toEqual([]);
    expect(clientDataRows(undefined)).toEqual([]);
    expect(clientDataRows({})).toEqual([]);
  });
});

describe("[CDVW] clientDataLabel", () => {
  it("[CDV6] extension first, then the built-in table, then the path", () => {
    ext.label = (path) => (path === "oauth.client.host" ? "Fork host label" : path === "my.key" ? "My key" : null);
    expect(clientDataLabel("oauth.client.host")).toBe("Fork host label");
    expect(clientDataLabel("my.key")).toBe("My key");
    expect(clientDataLabel("oauth.client.name")).toBe("App name");
    expect(clientDataLabel("cmc.counterparty.apiEndpoint")).toBe("Counterparty endpoint");
    expect(clientDataLabel("unknown.path")).toBe("unknown.path");
  });

  it("[CDV7] an extension label that is a catalog key is translated", () => {
    ext.label = () => "clientData.labels.oauthClientHost";
    expect(clientDataLabel("anything")).toBe("App host");
  });

  it("[CDV8] a throwing extension falls back to the built-in label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ext.label = () => {
      throw new Error("boom");
    };
    expect(clientDataLabel("oauth.client.host")).toBe("App host");
    warn.mockRestore();
  });
});
