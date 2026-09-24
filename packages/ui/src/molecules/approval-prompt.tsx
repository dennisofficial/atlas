"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "../lib/cn";
import { Button } from "../atoms/button";

export type ApprovalChoice = "proceed" | "always" | "decline" | (string & {});

export interface ApprovalOption {
  choice: ApprovalChoice;
  label: string;
}

export interface ApprovalPromptProps {
  heading?: string;
  reason?: string;
  evidence?: string[];
  dimensions?: string[];
  options: ApprovalOption[];
  selected?: number;
  note?: string;
  hints?: boolean;
  onPick?: (option: ApprovalOption) => void;
  style?: CSSProperties;
}

export function ApprovalPrompt({
  heading = "Atlas is asking before it runs this",
  reason,
  evidence = [],
  dimensions = [],
  options,
  selected = 0,
  note = "Rewind stays shut until this is answered — Esc declines and reopens it.",
  hints = true,
  onPick,
  style,
}: ApprovalPromptProps) {
  const [index, setIndex] = useState(selected);
  const grantOffered = options.some((option) => option.choice === "always");

  return (
    <section
      className="flex min-w-0 flex-col gap-5 rounded-md border border-border bg-surface-overlay px-7 py-6"
      style={style}
    >
      <span className="text-base font-medium text-primary">{heading}</span>

      {reason ? (
        <p className="m-0 text-base text-pretty text-secondary-foreground">
          {reason}
        </p>
      ) : null}

      {evidence.length ? (
        <div className="flex flex-col gap-[3px]">
          <span className="text-xs text-meta">
            what fired{dimensions.length ? `: ${dimensions.join(", ")}` : ""}
          </span>
          {evidence.map((line, i) => (
            <span
              key={i}
              className="pl-[14px] font-mono text-xs leading-[17px] text-hint"
            >
              - {line}
            </span>
          ))}
        </div>
      ) : null}

      <div role="radiogroup" className="flex flex-col">
        {options.map((option, i) => {
          const on = i === index;
          return (
            <Button
              key={option.choice || i}
              variant="ghost"
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                setIndex(i);
                onPick?.(option);
              }}
              className={cn(
                "h-auto w-full justify-start gap-3 rounded-xs px-2 py-0.5 text-left font-mono text-sm leading-5 font-normal whitespace-normal hover:bg-transparent active:translate-y-0",
                on
                  ? "text-primary hover:text-primary"
                  : "text-secondary-foreground hover:text-secondary-foreground",
              )}
            >
              <span className="w-[10px] shrink-0 text-primary">
                {on ? "❯" : ""}
              </span>
              <span>
                {i + 1}. {option.label}
              </span>
            </Button>
          );
        })}
      </div>

      {note ? (
        <span className="text-xs leading-[17px] text-pretty text-meta">
          {note}
        </span>
      ) : null}

      {hints ? (
        <div className="flex flex-wrap gap-6 font-mono text-xs text-hint">
          <span>
            <span className="text-meta">Enter</span> to proceed
          </span>
          <span>
            <span className="text-meta">Esc</span> to decline
          </span>
          <span>
            <span className="text-meta">↑↓</span> to choose
          </span>
          {grantOffered ? (
            <span>
              <span className="text-meta">a</span> to stop asking
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
