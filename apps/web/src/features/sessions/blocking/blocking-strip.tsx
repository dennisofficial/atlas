'use client'

import './blocking.css'

import { BLOCKING_SEND_NOTE, type BlockingCopy } from '@dltech/atlas-client/stream'

function BlockingPulse() {
  return (
    <span aria-hidden className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full rounded-full bg-primary opacity-50 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  )
}

export function BlockingStrip({ copy, elapsed }: { copy: BlockingCopy; elapsed: string }) {
  return (
    <div
      role="status"
      aria-label={`${copy.label}, ${elapsed}`}
      className="relative overflow-hidden rounded-t-lg border border-border border-b-0 bg-card"
    >
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <BlockingPulse />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{copy.label}</span>
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {elapsed}
        </span>
      </div>
      <p className="truncate px-3 pb-2 pl-7 text-xs text-muted-foreground">{BLOCKING_SEND_NOTE}</p>
      <div aria-hidden className="relative h-0.5 overflow-hidden bg-border/60">
        <span className="absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,var(--primary),transparent)] motion-safe:animate-[blocking-shimmer_2.2s_linear_infinite]" />
      </div>
    </div>
  )
}
