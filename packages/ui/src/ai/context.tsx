import type { ReactNode } from 'react'

import { Button } from '#components/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '#components/hover-card'
import { Progress } from '#components/progress'
import { cn } from '#lib/utils'

export interface ContextBreakdownRow {
  label: string
  tokens: number
}

export interface ContextProps {
  used: number | null
  limit: number
  breakdown?: ContextBreakdownRow[]
  trigger?: ReactNode
  className?: string
  children?: ReactNode
}

interface UsageInput {
  used: number | null
  limit: number
}

export function contextPercent({ used, limit }: UsageInput): number | null {
  if (used === null || limit <= 0) return null
  return Math.min(100, Math.round((used / limit) * 100))
}

const NOT_MEASURED = '—'
const WARN_PERCENT = 70
const DANGER_PERCENT = 90
const RING_RADIUS = 6
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function contextToneOf(percent: number | null): string {
  if (percent === null) return 'text-muted-foreground'
  if (percent >= DANGER_PERCENT) return 'text-destructive'
  if (percent >= WARN_PERCENT) return 'text-warning'
  return 'text-foreground'
}

export function ContextRing({ percent }: { percent: number | null }) {
  const filled = ((percent ?? 0) / 100) * RING_CIRCUMFERENCE
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      data-slot="context-ring"
      className={cn('size-4 shrink-0 -rotate-90', contextToneOf(percent))}
    >
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2"
        className="stroke-muted-foreground/25"
      />
      {percent === null || percent === 0 ? null : (
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
          className="stroke-current"
        />
      )}
    </svg>
  )
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

export function breakdownPercentOf({ tokens, limit }: { tokens: number; limit: number }): number {
  if (limit <= 0) return 0
  return Math.round((tokens / limit) * 100)
}

export function ContextBreakdown({
  rows,
  limit,
}: {
  rows: readonly ContextBreakdownRow[]
  limit: number
}) {
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>Estimated</span>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {`${formatTokens(row.tokens)}, ${breakdownPercentOf({ tokens: row.tokens, limit })}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Context({
  used,
  limit,
  breakdown = [],
  trigger,
  className,
  children,
}: ContextProps) {
  const percent = contextPercent({ used, limit })
  const reading = percent === null ? NOT_MEASURED : `${percent}%`

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={
              percent === null ? 'Context not measured yet' : `${percent}% of context used`
            }
            className={cn('text-sm font-bold tabular-nums', className)}
          />
        }
      >
        {trigger ?? (
          <>
            <ContextRing percent={percent} />
            {reading}
          </>
        )}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">Context</span>
          <span className="text-muted-foreground tabular-nums">
            {used === null ? 'not measured yet' : formatTokens(used)} / {formatTokens(limit)}
          </span>
        </div>
        {percent === null ? null : <Progress value={percent} aria-label="Context used" />}
        <ContextBreakdown rows={breakdown} limit={limit} />
        {children}
      </HoverCardContent>
    </HoverCard>
  )
}
