import { describe, expect, it } from 'bun:test'

import { ESessionDisplay } from '@dltech/atlas-client/stream'

import { EWorkKind, type ISessionEntry, type ISessionPartition } from '../session-groups'
import { EItemKind, ESectionKind, GROUP_GAP, sectionsOf } from '../session-sections'

const entry = (id: string, projectName = 'atlas'): ISessionEntry => ({
  id,
  title: `Session ${id}`,
  projectName,
  createdAt: '2026-11-03T20:00:00.000Z',
  updatedAt: '2026-11-03T20:00:00.000Z',
  status: ESessionDisplay.Idle,
  unread: false,
  work: { kind: EWorkKind.Branch, branch: null },
  children: [],
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

  it('lists a teammate indented under the session that spawned it', () => {
    const nested: ISessionPartition = {
      groups: [
        {
          key: 'atlas',
          name: 'atlas',
          projectId: 'atlas',
          sessions: [{ ...entry('main'), children: [entry('mate')] }],
        },
      ],
      inactive: [],
      archived: [],
    }
    const [section] = sectionsOf({ partition: nested, query: '', toggled: new Set() })
    expect(section?.count).toBe(2)
    expect(
      section?.data.map((item) =>
        item.kind === EItemKind.Session ? [item.entry.id, item.depth] : null,
      ),
    ).toEqual([
      ['main', 0],
      ['mate', 1],
    ])
  })

  it('keeps the parent of a teammate that matches the search', () => {
    const nested: ISessionPartition = {
      groups: [
        {
          key: 'atlas',
          name: 'atlas',
          projectId: 'atlas',
          sessions: [{ ...entry('main'), children: [entry('mate')] }],
        },
      ],
      inactive: [],
      archived: [],
    }
    const sections = sectionsOf({ partition: nested, query: 'session mate', toggled: new Set() })
    expect(sessionIds(sections[0]?.data ?? [])).toEqual(['main', 'mate'])
    expect(sections[0]?.count).toBe(2)
  })

  it('filters by title or project name and opens folded sections while searching', () => {
    const byProject = sectionsOf({ partition, query: ' rcp ', toggled: new Set() })
    expect(byProject.map((section) => section.title)).toEqual(['Inactive'])
    expect(sessionIds(byProject[0]?.data ?? [])).toEqual(['old'])
    const byTitle = sectionsOf({ partition, query: 'session b', toggled: new Set() })
    expect(byTitle.flatMap((section) => sessionIds(section.data))).toEqual(['b'])
  })
})
