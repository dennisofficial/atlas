import type { TerminalRow } from '@dltech/atlas-protocol'
import { MAX_TERMINALS } from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

export enum ETerminalTabState {
  Opening = 'opening',
  Open = 'open',
  Ended = 'ended',
  Failed = 'failed',
}

export type TerminalTab = {
  row: TerminalRow
  state: ETerminalTabState
  cwd: string | undefined
}

export type TerminalSnapshot = {
  tabs: readonly TerminalTab[]
  activeId: string | undefined
  loaded: boolean
  link: ETerminalConnection
  cursors: Readonly<Record<string, number>>
}

export const EMPTY_TERMINALS: TerminalSnapshot = {
  tabs: [],
  activeId: undefined,
  loaded: false,
  link: ETerminalConnection.Connecting,
  cursors: {},
}

export const tabStateOf = (row: TerminalRow): ETerminalTabState => {
  if (row.state === 'ended') return ETerminalTabState.Ended
  if (row.state === 'opening') return ETerminalTabState.Opening
  return ETerminalTabState.Open
}

export const isLiveTab = (tab: TerminalTab): boolean =>
  tab.state === ETerminalTabState.Opening || tab.state === ETerminalTabState.Open

export const liveCount = (snapshot: TerminalSnapshot): number =>
  snapshot.tabs.filter(isLiveTab).length

export const canOpen = (snapshot: TerminalSnapshot): boolean => liveCount(snapshot) < MAX_TERMINALS

export const activeTab = (snapshot: TerminalSnapshot): TerminalTab | undefined =>
  snapshot.tabs.find((tab) => tab.row.terminalId === snapshot.activeId)

const pickActive = (args: {
  tabs: readonly TerminalTab[]
  activeId: string | undefined
}): string | undefined => {
  const { tabs, activeId } = args
  if (activeId !== undefined && tabs.some((tab) => tab.row.terminalId === activeId)) return activeId
  const live = tabs.find(isLiveTab)
  return (live ?? tabs[tabs.length - 1])?.row.terminalId
}

export function withRows(args: {
  snapshot: TerminalSnapshot
  rows: readonly TerminalRow[]
  cwdOf?: (terminalId: string) => string | undefined
}): TerminalSnapshot {
  const { snapshot, rows, cwdOf } = args
  const cwdById = new Map(snapshot.tabs.map((tab) => [tab.row.terminalId, tab.cwd]))
  const tabs = rows.map((row) => ({
    row,
    state: tabStateOf(row),
    cwd: cwdOf?.(row.terminalId) ?? cwdById.get(row.terminalId),
  }))
  const alive = new Set(tabs.map((tab) => tab.row.terminalId))
  const cursors = Object.fromEntries(
    Object.entries(snapshot.cursors).filter(([terminalId]) => alive.has(terminalId)),
  )
  return {
    ...snapshot,
    tabs,
    activeId: pickActive({ tabs, activeId: snapshot.activeId }),
    loaded: true,
    cursors,
  }
}

export const selectTab = (snapshot: TerminalSnapshot, terminalId: string): TerminalSnapshot =>
  snapshot.tabs.some((tab) => tab.row.terminalId === terminalId)
    ? { ...snapshot, activeId: terminalId }
    : snapshot

export function closeTab(snapshot: TerminalSnapshot, terminalId: string): TerminalSnapshot {
  const tabs = snapshot.tabs.filter((tab) => tab.row.terminalId !== terminalId)
  const cursors = Object.fromEntries(
    Object.entries(snapshot.cursors).filter(([id]) => id !== terminalId),
  )
  return {
    ...snapshot,
    tabs,
    cursors,
    activeId: pickActive({ tabs, activeId: snapshot.activeId }),
  }
}

export const applyExit = (
  snapshot: TerminalSnapshot,
  frame: { terminalId: string; exitCode: number | null; signal: string | null },
): TerminalSnapshot => ({
  ...snapshot,
  tabs: snapshot.tabs.map((tab) =>
    tab.row.terminalId === frame.terminalId
      ? {
          ...tab,
          state: ETerminalTabState.Ended,
          row: {
            ...tab.row,
            state: 'ended',
            exitCode: frame.exitCode,
            signal: frame.signal,
            endedReason: 'exited',
            endedAt: Date.now(),
          },
        }
      : tab,
  ),
})

export const withLink = (
  snapshot: TerminalSnapshot,
  link: ETerminalConnection,
): TerminalSnapshot => (snapshot.link === link ? snapshot : { ...snapshot, link })

export const cursorOf = (snapshot: TerminalSnapshot, terminalId: string): number =>
  snapshot.cursors[terminalId] ?? 0

export const setCursor = (
  snapshot: TerminalSnapshot,
  terminalId: string,
  offset: number,
): TerminalSnapshot => {
  if (offset <= cursorOf(snapshot, terminalId)) return snapshot
  return { ...snapshot, cursors: { ...snapshot.cursors, [terminalId]: offset } }
}

export const cursorsOf = (snapshot: TerminalSnapshot): { terminalId: string; offset: number }[] =>
  snapshot.tabs.filter(isLiveTab).map((tab) => ({
    terminalId: tab.row.terminalId,
    offset: cursorOf(snapshot, tab.row.terminalId),
  }))

export const tabLabelOf = (row: TerminalRow): string => `Terminal ${row.ordinal}`

export const exitLabelOf = (row: TerminalRow): string => {
  if (row.endedReason === 'pod-slept') return 'went down with the pod'
  if (row.exitCode !== null) return `exit ${row.exitCode}`
  if (row.signal !== null) return row.signal
  return 'ended'
}

export const shellStateOf = (tab: TerminalTab): string => {
  if (tab.state === ETerminalTabState.Open) return 'running'
  if (tab.state === ETerminalTabState.Opening) return 'opening'
  if (tab.state === ETerminalTabState.Failed) return 'failed'
  return exitLabelOf(tab.row)
}

export const renameTab = (
  snapshot: TerminalSnapshot,
  terminalId: string,
  name: string,
): TerminalSnapshot => ({
  ...snapshot,
  tabs: snapshot.tabs.map((tab) =>
    tab.row.terminalId === terminalId ? { ...tab, row: { ...tab.row, name } } : tab,
  ),
})

export function resetCursor(snapshot: TerminalSnapshot, terminalId: string): TerminalSnapshot {
  if (snapshot.cursors[terminalId] === undefined) return snapshot
  const cursors = { ...snapshot.cursors }
  delete cursors[terminalId]
  return { ...snapshot, cursors }
}
