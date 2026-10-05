import type { ReactNode } from "react";
import { parseInline } from "./markdownParse";

/**
 * Minimal markdown rendering for app-provided consent messages
 * (`clientData["app-web-auth:description"]`). The text comes from the
 * requesting app — i.e. it is untrusted — so rendering builds React elements
 * directly (never innerHTML), which makes script injection structurally
 * impossible. Supported subset: `#`/`##`/`###` headings, `-`/`*` bullet
 * lists, paragraphs, and inline **bold**, *italic*, `code`,
 * [links](https://…) (http/https only).
 */

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((n, i) => {
    switch (n.kind) {
      case "bold":
        return <strong key={i}>{n.text}</strong>;
      case "italic":
        return <em key={i}>{n.text}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-body px-1 font-mono text-xs">
            {n.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary hover:underline"
          >
            {n.text}
          </a>
        );
      default:
        return n.text;
    }
  });
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] | null = null;
  let key = 0;
  const flushList = () => {
    if (!list) return;
    blocks.push(
      <ul key={key++} className="mb-2 list-disc pl-5">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    list = null;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      (list ??= []).push(bullet[1]);
      continue;
    }
    flushList();
    if (!line) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const cls = ["text-lg font-medium", "text-base font-medium", "text-sm font-medium"][
        heading[1].length - 1
      ];
      blocks.push(
        <p key={key++} className={`mb-2 ${cls}`}>
          {renderInline(heading[2])}
        </p>,
      );
    } else {
      blocks.push(
        <p key={key++} className="mb-2">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();
  return <div className="text-sm">{blocks}</div>;
}
