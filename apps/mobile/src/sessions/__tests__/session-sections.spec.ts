import { describe, expect, it } from 'bun:test'

import type { ISessionEntry, ISessionPartition } from '../session-groups'
import { ESectionKind, sectionsOf } from '../session-sections'
import { ESessionStatus } from '../session-status'

const entry = (id: string, projectName = 'atlas'): ISessionEntry => ({
  id,
  title: `Session ${id}`,
  projectName,
  updatedAt: '2026-11-03T20:00:00.000Z',
  status: ESessionStatus.Idle,
  detail: null,
})

const partition: ISessionPartition = {
  groups: [
    { key: 'atlas', name: 'atlas', sessions: [entry('a'), entry('b')] },
    { key: 'rcp', name: 'RCP', sessions: [] },
  ],
  inactive: [entry('old', 'RCP')],
  archived: [],
}

describe('sectionsOf', () => {
  it('keeps empty projects and folds inactive sessions until expanded', () => {
    const sections = sectionsOf({ partition, query: '', expanded: new Set() })
    expect(sections.map((section) => [section.title, section.count, section.data.length])).toEqual([
      ['atlas', 2, 2],
      ['RCP', 0, 0],
      ['Inactive', 1, 0],
    ])
    const open = sectionsOf({ partition, query: '', expanded: new Set([ESectionKind.Inactive]) })
    expect(open.at(-1)?.data.map((session) => session.id)).toEqual(['old'])
  })

  it('filters by title or project name and opens folded sections while searching', () => {
    const sections = sectionsOf({ partition, query: ' rcp ', expanded: new Set() })
    expect(sections.map((section) => [section.title, section.data.length])).toEqual([
      ['Inactive', 1],
    ])
    const byTitle = sectionsOf({ partition, query: 'session b', expanded: new Set() })
    expect(byTitle.flatMap((section) => section.data.map((session) => session.id))).toEqual(['b'])
  })
})
