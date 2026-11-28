'use client'

import { useCheckoutChoice } from '../checkouts/checkout-choice-context'
import { changeTotalsOf } from './change-totals'

export function ChangeTotalsLabel({ withFiles = false }: { withFiles?: boolean }) {
  const { changes, selectedId } = useCheckoutChoice()
  const totals = changeTotalsOf({ changes, selectedId })
  if (totals === undefined || totals.files === 0) return null
  return (
    <span
      data-change-totals
      className="inline-flex items-baseline gap-2 font-mono text-xs tabular-nums"
    >
      <span className="text-diff-add-foreground">+{totals.added}</span>
      <span className="text-diff-remove-foreground">−{totals.removed}</span>
      {withFiles ? (
        <span className="text-muted-foreground">
          {totals.files} {totals.files === 1 ? 'file' : 'files'}
        </span>
      ) : null}
    </span>
  )
}
