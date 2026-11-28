import type { ChangesState } from '../changes/use-changes'

export type ChangeTotals = { files: number; added: number; removed: number }

export function changeTotalsOf(args: {
  changes: ChangesState
  selectedId: string | undefined
}): ChangeTotals | undefined {
  if (args.changes.status !== 'ready') return undefined
  const { checkouts } = args.changes
  const shown =
    checkouts.find((checkout) => checkout.checkoutId === args.selectedId) ?? checkouts[0]
  if (shown === undefined) return undefined
  return shown.files.reduce<ChangeTotals>(
    (totals, file) => ({
      files: totals.files + 1,
      added: totals.added + file.additions,
      removed: totals.removed + file.deletions,
    }),
    { files: 0, added: 0, removed: 0 },
  )
}
