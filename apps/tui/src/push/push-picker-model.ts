import { EPublishKind, EPublishStatus, type PlanRow } from '@dltech/atlas-harness'

export enum EPickerOutcome {
  Chosen = 'chosen',
  Cancelled = 'cancelled',
}

export type PickerOutcome = { kind: EPickerOutcome.Chosen; ids: readonly string[] } | { kind: EPickerOutcome.Cancelled }

export enum EPickerLine {
  Header = 'header',
  Row = 'row',
}

export type PickerLine =
  | { kind: EPickerLine.Header; title: string; selected: number; total: number }
  | { kind: EPickerLine.Row; row: PlanRow }

export type PickerState = { selected: ReadonlySet<string>; cursorId: string | null; showAll: boolean }

const SECTIONS: readonly { kind: EPublishKind; title: string }[] = [
  { kind: EPublishKind.Skill, title: 'Skills' },
  { kind: EPublishKind.Instructions, title: 'Instructions' },
  { kind: EPublishKind.Mcp, title: 'MCP config' },
]

export function listOf({ rows, showAll }: { rows: readonly PlanRow[]; showAll: boolean }): readonly PlanRow[] {
  const shown = showAll ? rows : rows.filter((row) => row.status !== EPublishStatus.Unchanged)
  return SECTIONS.flatMap((section) => shown.filter((row) => row.item.kind === section.kind))
}

export const carriedOver = (rows: readonly PlanRow[]): number =>
  rows.filter((row) => row.status === EPublishStatus.Unchanged).length

export function startState(rows: readonly PlanRow[]): PickerState {
  const selected = new Set(rows.filter((row) => row.selected).map((row) => row.item.id))
  return { selected, cursorId: listOf({ rows, showAll: false })[0]?.item.id ?? null, showAll: false }
}

export function pickerLines({ list, selected }: { list: readonly PlanRow[]; selected: ReadonlySet<string> }): readonly PickerLine[] {
  return SECTIONS.flatMap((section): PickerLine[] => {
    const own = list.filter((row) => row.item.kind === section.kind)
    if (own.length === 0) return []
    const chosen = own.filter((row) => selected.has(row.item.id)).length
    return [
      { kind: EPickerLine.Header, title: section.title, selected: chosen, total: own.length },
      ...own.map((row): PickerLine => ({ kind: EPickerLine.Row, row })),
    ]
  })
}

export function moveCursor({ state, rows, delta }: { state: PickerState; rows: readonly PlanRow[]; delta: number }): PickerState {
  const list = listOf({ rows, showAll: state.showAll })
  if (list.length === 0) return state
  const at = list.findIndex((row) => row.item.id === state.cursorId)
  const next = Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta))
  return { ...state, cursorId: list[next]?.item.id ?? state.cursorId }
}

export function toggleSelected({ state, id }: { state: PickerState; id: string }): PickerState {
  const selected = new Set(state.selected)
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  return { ...state, selected }
}

export function toggleShowAll({ state, rows }: { state: PickerState; rows: readonly PlanRow[] }): PickerState {
  const showAll = !state.showAll
  const list = listOf({ rows, showAll })
  const kept = list.some((row) => row.item.id === state.cursorId)
  return { ...state, showAll, cursorId: kept ? state.cursorId : (list[0]?.item.id ?? null) }
}

export function selectionOf({ rows, selected }: { rows: readonly PlanRow[]; selected: ReadonlySet<string> }): {
  ids: readonly string[]
  bytes: number
} {
  const chosen = rows.filter((row) => selected.has(row.item.id))
  return { ids: chosen.map((row) => row.item.id), bytes: chosen.reduce((total, row) => total + row.item.bytes, 0) }
}
