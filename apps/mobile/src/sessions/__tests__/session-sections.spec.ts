import { describe, expect, it } from 'bun:test'

import { ESessionDisplay } from '@dltech/atlas-client/stream'

import { EWorkKind, type ISessionEntry, type ISessionPartition } from '../session-groups'
import {
  doneKeyOf,
  EItemKind,
  ESectionKind,
  GROUP_GAP,
  type SectionItem,
  sectionsOf,
} from '../session-sections'

const entry = (id: string, projectName = 'atlas'): ISessionEntry => ({
  id,
  title: `Session ${id}`,
  projectName,
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
    { key: 'rcp', name: 'RCP', projectId: 'rcp', sessions: [] },
  ],
  archived: [{ key: 'rcp', name: 'RCP', projectId: 'rcp', sessions: [entry('old', 'RCP')] }],
}

const sessionIds = (data: ReturnType<typeof sectionsOf>[number]['data']) =>
  data.flatMap((item) => (item.kind === EItemKind.Session ? [item.entry.id] : []))

const outlineOf = (data: readonly SectionItem[]): string[] =>
  data.map((item) => {
    if (item.kind === EItemKind.Session) return `${item.entry.id}@${item.depth}`
    if (item.kind === EItemKind.DoneToggle) {
      return `${item.key}#${item.count}${item.open ? '+' : '-'}`
    }
    return item.kind
  })

const partitionWithDone: ISessionPartition = {
  groups: [
    {
      key: 'atlas',
      name: 'atlas',
      projectId: 'atlas',
      sessions: [
        {
          ...entry('main'),
          children: [
            entry('mate'),
            { ...entry('gone'), archivedAt: '2026-11-03T19:00:00.000Z' },
            { ...entry('lost'), archivedAt: '2026-11-03T18:00:00.000Z' },
          ],
        },
      ],
    },
  ],
  archived: [],
}

describe('sectionsOf', () => {
  it('keeps empty projects and folds buckets until toggled', () => {
    const sections = sectionsOf({ partition, query: '', toggled: new Set() })
    expect(sections.map((section) => [section.title, section.count, section.data.length])).toEqual([
      ['atlas', 2, 2],
      ['RCP', 0, 0],
      ['Archived', 1, 0],
    ])
    expect(sections.map((section) => section.gapBefore)).toEqual([0, GROUP_GAP, GROUP_GAP])
    expect(sections[2]?.hint).toBeNull()
  })

  it('labels each project inside an open bucket', () => {
    const open = sectionsOf({
      partition,
      query: '',
      toggled: new Set<string>([ESectionKind.Archived]),
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
      archived: [],
    }
    const sections = sectionsOf({ partition: nested, query: 'session mate', toggled: new Set() })
    expect(sessionIds(sections[0]?.data ?? [])).toEqual(['main', 'mate'])
    expect(sections[0]?.count).toBe(2)
  })

  it('folds archived teammates behind a Done toggle under their parent', () => {
    const [section] = sectionsOf({ partition: partitionWithDone, query: '', toggled: new Set() })
    expect(section?.count).toBe(4)
    expect(outlineOf(section?.data ?? [])).toEqual(['main@0', 'mate@1', 'main:done#2-'])
  })

  it('shows the done teammates once their parent Done key is toggled', () => {
    const [section] = sectionsOf({
      partition: partitionWithDone,
      query: '',
      toggled: new Set([doneKeyOf('main')]),
    })
    expect(outlineOf(section?.data ?? [])).toEqual([
      'main@0',
      'mate@1',
      'main:done#2+',
      'gone@1',
      'lost@1',
    ])
  })

  it('does not add a Done toggle when no teammate is archived', () => {
    const [section] = sectionsOf({ partition, query: '', toggled: new Set() })
    expect(section?.data.some((item) => item.kind === EItemKind.DoneToggle)).toBe(false)
  })

  it('reveals a matching done teammate while searching', () => {
    const sections = sectionsOf({
      partition: partitionWithDone,
      query: 'session gone',
      toggled: new Set(),
    })
    expect(outlineOf(sections[0]?.data ?? [])).toEqual(['main@0', 'main:done#1+', 'gone@1'])
    expect(sections[0]?.count).toBe(2)
  })

  it('filters by title or project name and opens folded sections while searching', () => {
    const byProject = sectionsOf({ partition, query: ' rcp ', toggled: new Set() })
    expect(byProject.map((section) => section.title)).toEqual(['Archived'])
    expect(sessionIds(byProject[0]?.data ?? [])).toEqual(['old'])
    const byTitle = sectionsOf({ partition, query: 'session b', toggled: new Set() })
    expect(byTitle.flatMap((section) => sessionIds(section.data))).toEqual(['b'])
  })
})
