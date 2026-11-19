import { describe, expect, it } from 'bun:test'

import type { TerminalRow } from '@dltech/atlas-protocol'
import { MAX_TERMINALS } from '@dltech/atlas-protocol'

import {
  EMPTY_TERMINALS,
  ETerminalTabState,
  activeTab,
  applyExit,
  canOpen,
  closeTab,
  cursorOf,
  cursorsOf,
  resetCursor,
  selectTab,
  setCursor,
  tabStateOf,
  withRows,
} from '../terminal-model'

const row = (overrides: Partial<TerminalRow> = {}): TerminalRow => ({
  terminalId: 't1',
  ordinal: 1,
  name: 'Terminal 1',
  state: 'open',
  exitCode: null,
  signal: null,
  endedReason: null,
  createdAt: 1,
  endedAt: null,
  ...overrides,
})

const loaded = (rows: TerminalRow[]) => withRows({ snapshot: EMPTY_TERMINALS, rows })

describe('terminal model', () => {
  it('starts empty and opens nothing', () => {
    expect(EMPTY_TERMINALS.tabs).toEqual([])
    expect(EMPTY_TERMINALS.loaded).toBe(false)
    expect(EMPTY_TERMINALS.activeId).toBeUndefined()
  })

  it('maps rows to tab states, including a pod-slept end', () => {
    expect(tabStateOf(row())).toBe(ETerminalTabState.Open)
    expect(tabStateOf(row({ state: 'opening' }))).toBe(ETerminalTabState.Opening)
    expect(tabStateOf(row({ state: 'ended', endedReason: 'pod-slept', endedAt: 2 }))).toBe(
      ETerminalTabState.Ended,
    )
  })

  it('keeps the active terminal across a refetch and picks the first live one', () => {
    const first = loaded([row(), row({ terminalId: 't2', ordinal: 2 })])
    const selected = selectTab(first, 't2')
    const refreshed = withRows({
      snapshot: selected,
      rows: [
        row({ state: 'ended', endedReason: 'exited', exitCode: 0 }),
        row({ terminalId: 't2', ordinal: 2 }),
      ],
    })
    expect(refreshed.activeId).toBe('t2')
    expect(withRows({ snapshot: refreshed, rows: [row()] }).activeId).toBe('t1')
  })

  it('counts live terminals for the cap and keeps ended rows', () => {
    const rows = Array.from({ length: MAX_TERMINALS }, (_, index) =>
      row({ terminalId: `t${index}`, ordinal: index + 1 }),
    )
    const full = loaded(rows)
    expect(canOpen(full)).toBe(false)
    const withEnded = loaded([row({ state: 'ended', endedReason: 'exited', exitCode: 3 })])
    expect(canOpen(withEnded)).toBe(true)
    expect(withEnded.tabs.length).toBe(1)
    expect(withEnded.tabs[0]?.state).toBe(ETerminalTabState.Ended)
  })

  it('advances cursors by decoded bytes and never rewinds them', () => {
    const base = loaded([row()])
    const advanced = setCursor(base, 't1', 12)
    expect(cursorOf(advanced, 't1')).toBe(12)
    expect(cursorOf(setCursor(advanced, 't1', 4), 't1')).toBe(12)
    expect(cursorsOf(advanced)).toEqual([{ terminalId: 't1', offset: 12 }])
    expect(cursorOf(resetCursor(advanced, 't1'), 't1')).toBe(0)
  })

  it('marks a terminal ended with its exit code', () => {
    const ended = applyExit(loaded([row()]), { terminalId: 't1', exitCode: 3, signal: null })
    const tab = activeTab(ended)
    expect(tab?.state).toBe(ETerminalTabState.Ended)
    expect(tab?.row.exitCode).toBe(3)
    expect(tab?.row.endedReason).toBe('exited')
  })

  it('drops a closed terminal and its cursor', () => {
    const both = setCursor(loaded([row(), row({ terminalId: 't2', ordinal: 2 })]), 't2', 8)
    const closed = closeTab(selectTab(both, 't2'), 't2')
    expect(closed.tabs.map((tab) => tab.row.terminalId)).toEqual(['t1'])
    expect(closed.cursors.t2).toBeUndefined()
    expect(closed.activeId).toBe('t1')
  })
})
