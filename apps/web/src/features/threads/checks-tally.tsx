import { CheckIcon, XIcon } from 'lucide-react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import type { ChecksTally as ChecksTallyValue } from './data/header-model'

export function checksTallyLabelOf(checks: ChecksTallyValue): string {
  return `${checks.running} running, ${checks.passed} passed, ${checks.failed} failed`
}

export function ChecksTally({ checks }: { checks: ChecksTallyValue }) {
  return (
    <span
      role="img"
      aria-label={checksTallyLabelOf(checks)}
      className="inline-flex items-center gap-1.5 tabular-nums"
    >
      {checks.running > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-warning">
          <Spinner aria-hidden role="presentation" className="size-3" />
          {checks.running}
        </span>
      ) : null}
      {checks.passed > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-success">
          {checks.passed}
          <CheckIcon aria-hidden className="size-3" />
        </span>
      ) : null}
      {checks.failed > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-destructive">
          {checks.failed}
          <XIcon aria-hidden className="size-3" />
        </span>
      ) : null}
    </span>
  )
}
