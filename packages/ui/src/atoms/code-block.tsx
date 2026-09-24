"use client";

import { useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "../lib/cn";

type SyntaxToken = "comment" | "string" | "keyword" | "constant" | "type";

interface SyntaxRule {
  re: RegExp;
  token: SyntaxToken;
}

interface Mark {
  start: number;
  end: number;
  token: SyntaxToken;
}

const RULES: SyntaxRule[] = [
  { re: /(\/\/[^\n]*|#[^\n]*)/g, token: "comment" },
  { re: /('[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g, token: "string" },
  {
    re: /\b(const|let|var|function|return|if|else|for|while|import|from|export|class|extends|await|async|new|type|interface|enum|def|fn|pub|match)\b/g,
    token: "keyword",
  },
  { re: /\b(true|false|null|undefined|\d+(\.\d+)?)\b/g, token: "constant" },
  { re: /([A-Z][A-Za-z0-9_]*)/g, token: "type" },
];

const TOKEN_CLASSES: Record<SyntaxToken, string> = {
  comment: "italic text-syntax-comment",
  string: "text-syntax-string",
  keyword: "font-semibold text-syntax-keyword",
  constant: "text-syntax-constant",
  type: "text-syntax-type",
};

function paint(line: string): ReactNode[] {
  const marks: Mark[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = rule.re.exec(line)) !== null) {
      const start = hit.index;
      const end = start + hit[0].length;
      if (marks.some((mark) => start < mark.end && end > mark.start)) continue;
      marks.push({ start, end, token: rule.token });
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach((mark, i) => {
    if (mark.start > at)
      out.push(<span key={`p${i}`}>{line.slice(at, mark.start)}</span>);
    out.push(
      <span key={`m${i}`} className={TOKEN_CLASSES[mark.token]}>
        {line.slice(mark.start, mark.end)}
      </span>,
    );
    at = mark.end;
  });
  if (at < line.length) out.push(<span key="tail">{line.slice(at)}</span>);
  return out;
}

export type CodeBlockProps = ComponentProps<"div"> & {
  code: string;
  language?: string;
  filename?: string;
  lineNumbers?: boolean;
  startLine?: number;
  copyable?: boolean;
  maxHeight?: number | string;
};

export function CodeBlock({
  code,
  language,
  filename,
  lineNumbers = false,
  startLine = 1,
  copyable = true,
  maxHeight,
  className,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");

  const handleCopy = () => {
    if (navigator.clipboard) void navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-md border border-border bg-surface-panel",
        className,
      )}
      {...props}
    >
      {filename || language || copyable ? (
        <div className="flex h-control-sm items-center gap-4 border-b border-border bg-muted pl-5 pr-4">
          <span className="flex-1 truncate font-mono text-2xs text-meta">
            {filename ?? language}
          </span>
          {filename && language ? (
            <span className="font-mono text-2xs text-hint">{language}</span>
          ) : null}
          {copyable ? (
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "rounded-xs px-2 py-1 font-mono text-2xs transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
                copied ? "text-success" : "text-hint hover:text-foreground",
              )}
            >
              {copied ? "✓ copied" : "⧉ copy"}
            </button>
          ) : null}
        </div>
      ) : null}
      <pre
        className="m-0 overflow-auto px-5 py-4 font-mono text-sm text-foreground [tab-size:2]"
        style={maxHeight === undefined ? undefined : { maxHeight }}
      >
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex gap-6 whitespace-pre">
              {lineNumbers ? (
                <span className="min-w-12 shrink-0 select-none text-right text-diff-gutter">
                  {startLine + i}
                </span>
              ) : null}
              <span>{paint(line)}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
