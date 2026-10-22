import type { PublishState } from './publish-state'
import type { Publishable } from './publishables'

export enum EPublishStatus {
  New = 'new',
  Changed = 'changed',
  Unchanged = 'unchanged',
}

export type PlanRow = { item: Publishable; status: EPublishStatus; selected: boolean }

export type PushPlan = { rows: readonly PlanRow[]; removed: readonly string[] }

export function planPush(args: { items: readonly Publishable[]; last: PublishState }): PushPlan {
  const rows = args.items.map((item): PlanRow => {
    const known = args.last.items[item.id]
    if (known === undefined) return { item, status: EPublishStatus.New, selected: true }
    const status = known.hash === item.hash ? EPublishStatus.Unchanged : EPublishStatus.Changed
    return { item, status, selected: known.selected }
  })
  const present = new Set(args.items.map((item) => item.id))
  const removed = Object.entries(args.last.items)
    .filter(([id, known]) => known.selected && !present.has(id))
    .map(([id]) => id)
  return { rows, removed }
}

export const hasChanges = (plan: PushPlan): boolean =>
  pendingRows(plan).length > 0 || plan.removed.length > 0

export const pendingRows = (plan: PushPlan): readonly PlanRow[] =>
  plan.rows.filter((row) => row.status !== EPublishStatus.Unchanged)

export function stateAfterPush(args: {
  rows: readonly PlanRow[]
  selectedIds: ReadonlySet<string>
  version: number
}): PublishState {
  const items: PublishState['items'] = {}
  for (const row of args.rows) {
    items[row.item.id] = { selected: args.selectedIds.has(row.item.id), hash: row.item.hash }
  }
  return { version: args.version, items }
}
