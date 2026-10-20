import type { ReactNode } from "react";

import { Button } from "#components/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "#components/hover-card";
import { Progress } from "#components/progress";
import { cn } from "#lib/utils";

export interface ContextBreakdownRow {
  label: string;
  tokens: number;
}

export interface ContextProps {
  used: number;
  limit: number;
  breakdown?: ContextBreakdownRow[];
  trigger?: ReactNode;
  className?: string;
}

interface UsageInput {
  used: number;
  limit: number;
}

export function contextPercent({ used, limit }: UsageInput): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function Context({
  used,
  limit,
  breakdown = [],
  trigger,
  className,
}: ContextProps) {
  const percent = contextPercent({ used, limit });

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={<Button variant="ghost" size="sm" className={cn("tabular-nums", className)} />}
      >
        {trigger ?? `${percent}% context`}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">Context</span>
          <span className="text-muted-foreground tabular-nums">
            {formatTokens(used)} / {formatTokens(limit)}
          </span>
        </div>
        <Progress value={percent} aria-label="Context used" />
        {breakdown.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {breakdown.map((row) => (
              <li key={row.label} className="flex justify-between gap-3">
                <span>{row.label}</span>
                <span className="tabular-nums">{formatTokens(row.tokens)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
