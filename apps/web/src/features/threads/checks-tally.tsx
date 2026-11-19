import { CheckIcon, ClockIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

import type { ChecksTally as ChecksTallyValue } from './data/header-model'

export function checksTallyLabelOf(checks: ChecksTallyValue): string {
  const counts = `${checks.running} running, ${checks.passed} passed, ${checks.failed} failed`
  return checks.expected > 0 ? `${counts}, ${checks.expected} waiting` : counts
}

function ChecksSegment({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export function ChecksTally({ checks }: { checks: ChecksTallyValue }) {
  return (
    <span
      role="img"
      aria-label={checksTallyLabelOf(checks)}
      className="inline-flex items-center gap-1.5 tabular-nums"
    >
      {checks.running > 0 ? (
        <ChecksSegment hint="Checks running">
          <span className="inline-flex items-center gap-0.5 text-warning">
            {checks.running}
            <Spinner aria-hidden role="presentation" />
          </span>
        </ChecksSegment>
      ) : null}
      {checks.passed > 0 ? (
        <ChecksSegment hint="Checks passed">
          <span className="inline-flex items-center gap-0.5 text-success">
            {checks.passed}
            <CheckIcon aria-hidden className="size-3" />
          </span>
        </ChecksSegment>
      ) : null}
      {checks.failed > 0 ? (
        <ChecksSegment hint="Checks failed">
          <span className="inline-flex items-center gap-0.5 text-destructive">
            {checks.failed}
            <XIcon aria-hidden className="size-3" />
          </span>
        </ChecksSegment>
      ) : null}
      {checks.expected > 0 ? (
        <ChecksSegment hint="Waiting for required checks">
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            {checks.expected}
            <ClockIcon aria-hidden className="size-3" />
          </span>
        </ChecksSegment>
      ) : null}
    </span>
  )
}
