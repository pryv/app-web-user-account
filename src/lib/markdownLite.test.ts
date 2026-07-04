import { describe, it, expect } from "vitest";
import { parseInline } from "./markdownLite";

describe("parseInline", () => {
  it("parses bold, italic, code and text runs", () => {
    expect(parseInline("a **b** *c* `d` e")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "italic", text: "c" },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " e" },
    ]);
  });

  it("parses http(s) links", () => {
    expect(parseInline("see [docs](https://pryv.com)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "docs", href: "https://pryv.com" },
    ]);
  });

  it("refuses non-http(s) link schemes (renders them as plain text)", () => {
    for (const input of ["[x](javascript:alert(1))", "[x](data:text/html;base64,xx)"]) {
      const nodes = parseInline(input);
      expect(nodes.every((n) => n.kind === "text")).toBe(true);
      expect(nodes.map((n) => n.text).join("")).toBe(input);
    }
  });

  it("passes plain text through untouched", () => {
    expect(parseInline("no markup here")).toEqual([{ kind: "text", text: "no markup here" }]);
  });
});
