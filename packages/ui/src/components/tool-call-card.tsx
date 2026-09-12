import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

export type ToolCallKind =
  "read" | "search" | "edit" | "shell" | "web" | "skill";
export type ToolCallState = "running" | "settled" | "failed";

export interface ToolCallRow {
  label: string;
  note?: string;
  failed?: boolean;
}

export interface ToolCallCardProps {
  sentence?: string;
  measure?: string;
  kind?: ToolCallKind;
  state?: ToolCallState;
  note?: string;
  detail?: ReactNode;
  rows?: ToolCallRow[];
  children?: ReactNode;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  style?: CSSProperties;
}

const KIND_APPEARANCE: Record<ToolCallKind, { glyph: string; ink: string }> = {
  read: { glyph: "⏺", ink: "text-meta" },
  search: { glyph: "⏺", ink: "text-meta" },
  edit: { glyph: "⏺", ink: "text-primary" },
  shell: { glyph: "⏺", ink: "text-code" },
  web: { glyph: "⏺", ink: "text-steel" },
  skill: { glyph: "◆", ink: "text-external" },
};

export function ToolCallCard({
  sentence,
  measure,
  kind = "read",
  state = "settled",
  note,
  detail,
  children,
  expanded,
  onToggle,
  rows,
  style,
}: ToolCallCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = expanded === undefined ? uncontrolledOpen : expanded;
  const failed = state === "failed";
  const running = state === "running";
  const appearance = KIND_APPEARANCE[kind];
  const hasBody = Boolean(children || (rows && rows.length));

  const handleToggle = () => {
    if (running) return;
    if (expanded === undefined) setUncontrolledOpen(!isOpen);
    onToggle?.(!isOpen);
  };

  return (
    <div className="min-w-0" style={style}>
      <div
        onClick={hasBody ? handleToggle : undefined}
        className={cn(
          "flex min-w-0 items-baseline gap-[7px] rounded-xs py-px pr-2 font-mono text-sm",
          hasBody ? "cursor-pointer" : "cursor-default",
        )}
      >
        <span
          className={cn(
            "w-[10px] shrink-0 text-center",
            failed ? "text-destructive" : appearance.ink,
          )}
        >
          {running ? <Spinner /> : failed ? "✗" : appearance.glyph}
        </span>
        <span
          className={cn(
            "min-w-0 truncate",
            failed ? "text-destructive" : "text-secondary-foreground",
          )}
        >
          {running && !sentence ? "Working…" : sentence}
        </span>
        {measure ? <span className="shrink-0 text-rule">{measure}</span> : null}
        <span className="flex-1" />
        {note ? (
          <span
            className={cn(
              "shrink-0",
              failed ? "text-destructive" : "text-hint",
            )}
          >
            {note}
          </span>
        ) : null}
        {hasBody ? (
          <span className="shrink-0 text-rule">{isOpen ? "▾" : "▸"}</span>
        ) : null}
      </div>

      {isOpen && rows && rows.length ? (
        <div className="flex flex-col pl-[17px]">
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex min-w-0 items-baseline gap-[7px] font-mono text-sm"
            >
              <span className="shrink-0 text-rule">⎿</span>
              <span
                className={cn(
                  "truncate",
                  row.failed ? "text-destructive" : "text-meta",
                )}
              >
                {row.label}
              </span>
              <span className="flex-1" />
              {row.note ? (
                <span className="shrink-0 text-hint">{row.note}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {isOpen && children ? (
        <div className="min-w-0 pt-2 pl-[17px]">{children}</div>
      ) : null}
      {detail && !isOpen ? (
        <div className="min-w-0 pt-2 pl-[17px]">{detail}</div>
      ) : null}
    </div>
  );
}
