import { ECrewStanding } from './crew-retirement'

export const CREW_SETTLED_TAIL = 2

export const CREW_FOLD_MIN = 2

export type CrewFold<TRow> = {
  shown: readonly TRow[]
  collapsed: readonly TRow[]
  collapsedFailed: boolean
}

/**
 * Only a settled row may fold. A live row, and a held one — an unread result, an unacknowledged
 * failure, a job or an open pull request something still depends on — always shows, so collapsing
 * a tier can never be what loses the reading that mattered. The newest settled rows stay as a
 * tail so a just-finished child is still seen finishing; `collapsed` keeps its count when
 * expanded so the toggle line does not change its number under the cursor.
 */
export function foldCrew<TRow>(args: {
  rows: readonly TRow[]
  standings: ReadonlyMap<string, ECrewStanding>
  expanded: boolean
  keyOf: (row: TRow) => string
  wentWrong: (row: TRow) => boolean
}): CrewFold<TRow> {
  const { rows, standings, keyOf } = args

  const isSettled = (row: TRow): boolean => standings.get(keyOf(row)) === ECrewStanding.Settled

  const settled = rows.filter(isSettled)
  const beyondTail = settled.length - CREW_SETTLED_TAIL
  if (beyondTail < CREW_FOLD_MIN) return { shown: rows, collapsed: [], collapsedFailed: false }

  const collapsed = settled.slice(0, beyondTail)
  const collapsedKeys = new Set(collapsed.map(keyOf))

  return {
    shown: args.expanded ? rows : rows.filter((row) => !collapsedKeys.has(keyOf(row))),
    collapsed,
    collapsedFailed: collapsed.some(args.wentWrong),
  }
}
