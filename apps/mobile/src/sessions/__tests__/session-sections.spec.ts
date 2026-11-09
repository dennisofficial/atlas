import { describe, expect, it } from 'bun:test'

import {
  ESessionKind,
  EWorkKind,
  type ISessionEntry,
  type ISessionPartition,
} from '../session-groups'
import { EItemKind, ESectionKind, GROUP_GAP, sectionsOf } from '../session-sections'
import { ESessionStatus } from '../session-status'

const entry = (id: string, projectName = 'atlas'): ISessionEntry => ({
  id,
  kind: ESessionKind.V1,
  title: `Session ${id}`,
  projectName,
  createdAt: '2026-11-03T20:00:00.000Z',
  updatedAt: '2026-11-03T20:00:00.000Z',
  pinned: false,
  status: ESessionStatus.Idle,
  unread: false,
  work: { kind: EWorkKind.Branch, branch: null },
})

const partition: ISessionPartition = {
  groups: [
    { key: 'atlas', name: 'atlas', projectId: 'atlas', sessions: [entry('a'), entry('b')] },
    { key: 'rcp', name: 'RCP', projectId: 'rcp', sessions: [] },
  ],
  inactive: [{ key: 'rcp', name: 'RCP', projectId: 'rcp', sessions: [entry('old', 'RCP')] }],
  archived: [],
}

const sessionIds = (data: ReturnType<typeof sectionsOf>[number]['data']) =>
  data.flatMap((item) => (item.kind === EItemKind.Session ? [item.entry.id] : []))

describe('sectionsOf', () => {
  it('keeps empty projects and folds buckets until toggled', () => {
    const sections = sectionsOf({ partition, query: '', toggled: new Set() })
    expect(sections.map((section) => [section.title, section.count, section.data.length])).toEqual([
      ['atlas', 2, 2],
      ['RCP', 0, 0],
      ['Inactive', 1, 0],
    ])
    expect(sections.map((section) => section.gapBefore)).toEqual([0, GROUP_GAP, GROUP_GAP])
    expect(sections[2]?.hint).toBe('Last 72h')
  })

  it('labels each project inside an open bucket', () => {
    const open = sectionsOf({
      partition,
      query: '',
      toggled: new Set<string>([ESectionKind.Inactive]),
    })
    expect(open.at(-1)?.data.map((item) => item.kind)).toEqual([
      EItemKind.ProjectLabel,
      EItemKind.Session,
    ])
  })

  it('collapsing a project hides its sessions but keeps its count', () => {
    const sections = sectionsOf({ partition, query: '', toggled: new Set(['atlas']) })
    expect(sections[0]).toMatchObject({ title: 'atlas', expanded: false, count: 2, data: [] })
  })

  it('filters by title or project name and opens folded sections while searching', () => {
    const byProject = sectionsOf({ partition, query: ' rcp ', toggled: new Set() })
    expect(byProject.map((section) => section.title)).toEqual(['Inactive'])
    expect(sessionIds(byProject[0]?.data ?? [])).toEqual(['old'])
    const byTitle = sectionsOf({ partition, query: 'session b', toggled: new Set() })
    expect(byTitle.flatMap((section) => sessionIds(section.data))).toEqual(['b'])
  })
})
