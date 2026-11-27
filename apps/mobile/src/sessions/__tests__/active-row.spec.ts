import { describe, expect, it } from 'bun:test'

import { ESessionDisplay } from '@dltech/atlas-client/stream'

import { activeRowOf, centerMoveOf, ECenterMove, isActiveCellOf } from '../active-row'
import { EWorkKind, type ISessionEntry, type ISessionPartition } from '../session-groups'
import { sectionsOf } from '../session-sections'

const entry = (id: string): ISessionEntry => ({
  id,
  title: `Session ${id}`,
  projectName: 'atlas',
  createdAt: '2026-11-03T20:00:00.000Z',
  updatedAt: '2026-11-03T20:00:00.000Z',
  archivedAt: null,
  status: ESessionDisplay.Idle,
  unread: false,
  work: { kind: EWorkKind.Branch, branch: null },
  children: [],
})

const partition: ISessionPartition = {
  groups: [
    { key: 'atlas', name: 'atlas', projectId: 'atlas', sessions: [entry('a'), entry('b')] },
    { key: 'rcp', name: 'RCP', projectId: 'rcp', sessions: [entry('c'), entry('d')] },
  ],
  archived: [],
}

const sections = sectionsOf({ partition, query: '', toggled: new Set() })

describe('activeRowOf', () => {
  it('finds the open session and counts the section header cell before its rows', () => {
    const row = activeRowOf({ sections, activeId: 'd' })
    expect(row?.sectionIndex).toBe(1)
    expect(row?.itemIndex).toBe(
      (sections[1]?.data.findIndex((item) => item.key === row?.key) ?? -1) + 1,
    )
  })

  it('finds nothing when no session is open or the session is not listed', () => {
    expect(activeRowOf({ sections, activeId: null })).toBeNull()
    expect(activeRowOf({ sections, activeId: 'gone' })).toBeNull()
  })
})

describe('isActiveCellOf', () => {
  it('matches only the session row of the open session', () => {
    const row = activeRowOf({ sections, activeId: 'a' })
    const item = sections[0]?.data.find((candidate) => candidate.key === row?.key)
    expect(isActiveCellOf({ item, activeKey: row?.key ?? null })).toBe(true)
    expect(isActiveCellOf({ item: sections[0], activeKey: row?.key ?? null })).toBe(false)
    expect(isActiveCellOf({ item, activeKey: null })).toBe(false)
  })
})

describe('centerMoveOf', () => {
  it('waits until the list knows its height', () => {
    expect(centerMoveOf({ row: null, viewportHeight: null })).toBe(ECenterMove.Wait)
    expect(centerMoveOf({ row: null, viewportHeight: 0 })).toBe(ECenterMove.Wait)
  })

  it('leaves the list at rest when the row already sits in its top half', () => {
    expect(centerMoveOf({ row: { top: 300, height: 80 }, viewportHeight: 800 })).toBe(
      ECenterMove.Stay,
    )
  })

  it('scrolls a row below the middle up to the middle', () => {
    expect(centerMoveOf({ row: { top: 500, height: 80 }, viewportHeight: 800 })).toBe(
      ECenterMove.Scroll,
    )
  })

  it('scrolls to a row the list has not laid out yet', () => {
    expect(centerMoveOf({ row: null, viewportHeight: 800 })).toBe(ECenterMove.Scroll)
  })
})
