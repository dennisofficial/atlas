import { describe, expect, it } from 'bun:test'

import { EWorkKind, type ISessionEntry, type ISessionPartition } from '../session-groups'
import { ESectionKind, sectionsOf } from '../session-sections'
import { ESessionStatus } from '../session-status'

const entry = (id: string, projectName = 'atlas'): ISessionEntry => ({
  id,
  title: `Session ${id}`,
  projectId: projectName,
  projectName,
  updatedAt: '2026-11-03T20:00:00.000Z',
  status: ESessionStatus.Idle,
  unread: false,
  work: { kind: EWorkKind.Branch, branch: null },
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
    const sections = sectionsOf({ partition, query: '', toggled: new Set() })
    expect(sections.map((section) => [section.title, section.count, section.data.length])).toEqual([
      ['atlas', 2, 2],
      ['RCP', 0, 0],
      ['Inactive', 1, 0],
    ])
    const open = sectionsOf({
      partition,
      query: '',
      toggled: new Set<string>([ESectionKind.Inactive]),
    })
    expect(open.at(-1)?.data.map((session) => session.id)).toEqual(['old'])
  })

  it('filters by title or project name and opens folded sections while searching', () => {
    const sections = sectionsOf({ partition, query: ' rcp ', toggled: new Set() })
    expect(sections.map((section) => [section.title, section.data.length])).toEqual([
      ['Inactive', 1],
    ])
    const byTitle = sectionsOf({ partition, query: 'session b', toggled: new Set() })
    expect(byTitle.flatMap((section) => section.data.map((session) => session.id))).toEqual(['b'])
  })
})

describe('collapsing a project', () => {
  it('hides its sessions but keeps its count', () => {
    const sections = sectionsOf({ partition, query: '', toggled: new Set(['atlas']) })
    expect(sections[0]).toMatchObject({ title: 'atlas', expanded: false, count: 2, data: [] })
  })
})
