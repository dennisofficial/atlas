import type { CSSProperties } from "react";

import { cn } from "../lib/cn";

const MINUS = "−";

export type DiffLineKind = "add" | "remove" | "context" | "gap";
export type DiffMode = "inline" | "split";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffViewerProps {
  path: string;
  lines: DiffLine[];
  added?: number;
  removed?: number;
  mode?: DiffMode;
  hunk?: string;
  style?: CSSProperties;
}

interface RowProps {
  line: DiffLine;
  mode: DiffMode;
}

function Row({ line, mode }: RowProps) {
  const added = line.kind === "add";
  const removed = line.kind === "remove";
  const gap = line.kind === "gap";
  const number =
    (gap
      ? "⋯"
      : mode === "split"
        ? line.oldNumber
        : (line.newNumber ?? line.oldNumber)) ?? "";

  return (
    <div
      className={cn(
        "flex min-w-0",
        added && "bg-diff-add",
        removed && "bg-diff-remove opacity-[0.88]",
        gap && "bg-diff-band",
      )}
    >
      <span className="w-10 shrink-0 px-3 text-right text-diff-gutter select-none">
        {number}
      </span>
      <span
        className={cn(
          "w-6 shrink-0 text-center",
          added
            ? "text-diff-add-foreground"
            : removed
              ? "text-diff-remove-foreground"
              : "text-diff-gutter",
        )}
      >
        {added ? "+" : removed ? MINUS : " "}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre",
          gap ? "text-hint italic" : "text-foreground",
        )}
      >
        {line.text}
      </span>
    </div>
  );
}

export function DiffViewer({
  path,
  lines,
  added,
  removed,
  mode = "inline",
  hunk,
  style,
}: DiffViewerProps) {
  return (
    <div
      className="min-w-0 overflow-hidden rounded-md border border-border bg-surface-panel font-mono text-sm"
      style={style}
    >
      <div className="flex h-[26px] items-center gap-4 border-b border-border bg-muted px-5">
        <span className="flex-1 truncate text-xs text-meta">{path}</span>
        {added !== undefined ? (
          <span className="text-xs text-diff-add-foreground">+{added}</span>
        ) : null}
        {removed !== undefined ? (
          <span className="text-xs text-diff-remove-foreground">
            {MINUS}
            {removed}
          </span>
        ) : null}
      </div>
      {hunk ? (
        <div className="bg-diff-band px-5 py-px text-xs font-semibold text-primary">
          {hunk}
        </div>
      ) : null}
      <div className="overflow-auto">
        {lines.map((line, i) => (
          <Row key={i} line={line} mode={mode} />
        ))}
      </div>
    </div>
  );
}
