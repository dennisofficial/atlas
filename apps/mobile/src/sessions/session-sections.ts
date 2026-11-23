import { splitTeammates } from '@dltech/atlas-client/stream'

import type { IProjectGroup, ISessionEntry, ISessionPartition } from './session-groups'

export enum ESectionKind {
  Project = 'project',
  Archived = 'archived',
}

export enum EItemKind {
  Session = 'session',
  ProjectLabel = 'project-label',
  DoneToggle = 'done-toggle',
}

export type SectionItem =
  | { kind: EItemKind.Session; key: string; entry: ISessionEntry; depth: number }
  | { kind: EItemKind.ProjectLabel; key: string; name: string }
  | { kind: EItemKind.DoneToggle; key: string; count: number; open: boolean; depth: number }

export interface ISessionSection {
  key: string
  title: string
  hint: string | null
  kind: ESectionKind
  projectId: string | null
  count: number
  expanded: boolean
  gapBefore: number
  data: SectionItem[]
}

export const GROUP_GAP = 12
export const BUCKET_GAP = 2

type DoneOpen = (parentId: string) => boolean

export const doneKeyOf = (parentId: string): string => `${parentId}:done`

const childrenRowsOf = ({
  entries,
  depth,
  doneOpen,
}: {
  entries: readonly ISessionEntry[]
  depth: number
  doneOpen: DoneOpen
}): SectionItem[] => entries.flatMap((entry) => rowsOf({ entry, depth, doneOpen }))

const doneToggleOf = ({
  parentId,
  count,
  open,
  depth,
}: {
  parentId: string
  count: number
  open: boolean
  depth: number
}): SectionItem => ({
  kind: EItemKind.DoneToggle,
  key: doneKeyOf(parentId),
  count,
  open,
  depth,
})

const rowsOf = ({
  entry,
  depth,
  doneOpen,
}: {
  entry: ISessionEntry
  depth: number
  doneOpen: DoneOpen
}): SectionItem[] => {
  const { active, done } = splitTeammates(entry.children)
  const childDepth = depth + 1
  const open = done.length > 0 && doneOpen(entry.id)
  return [
    { kind: EItemKind.Session, key: entry.id, entry, depth },
    ...childrenRowsOf({ entries: active, depth: childDepth, doneOpen }),
    ...(done.length > 0
      ? [doneToggleOf({ parentId: entry.id, count: done.length, open, depth: childDepth })]
      : []),
    ...(open ? childrenRowsOf({ entries: done, depth: childDepth, doneOpen }) : []),
  ]
}

const countOf = (entry: ISessionEntry): number =>
  1 + entry.children.reduce((total, child) => total + countOf(child), 0)

const matches = ({ entry, needle }: { entry: ISessionEntry; needle: string }): boolean =>
  needle.length === 0 ||
  entry.title.toLowerCase().includes(needle) ||
  entry.projectName.toLowerCase().includes(needle)

const filterEntry = ({
  entry,
  needle,
}: {
  entry: ISessionEntry
  needle: string
}): ISessionEntry | undefined => {
  const children = entry.children.flatMap((child) => {
    const kept = filterEntry({ entry: child, needle })
    return kept === undefined ? [] : [kept]
  })
  if (children.length > 0) return { ...entry, children }
  return matches({ entry, needle }) ? { ...entry, children: [] } : undefined
}

const filterGroup = ({
  group,
  needle,
}: {
  group: IProjectGroup
  needle: string
}): IProjectGroup => ({
  ...group,
  sessions: group.sessions.flatMap((entry) => {
    const kept = filterEntry({ entry, needle })
    return kept === undefined ? [] : [kept]
  }),
})

const countOfGroup = (group: IProjectGroup): number =>
  group.sessions.reduce((total, entry) => total + countOf(entry), 0)

const rowsOfGroup = ({
  group,
  doneOpen,
}: {
  group: IProjectGroup
  doneOpen: DoneOpen
}): SectionItem[] => childrenRowsOf({ entries: group.sessions, depth: 0, doneOpen })

export const sectionsOf = ({
  partition,
  query,
  toggled,
}: {
  partition: ISessionPartition
  query: string
  toggled: ReadonlySet<string>
}): ISessionSection[] => {
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const doneOpen: DoneOpen = (parentId) => searching || toggled.has(doneKeyOf(parentId))
  const projects = partition.groups
    .map((group) => filterGroup({ group, needle }))
    .filter((group) => !searching || group.sessions.length > 0)
    .map((group, index) => {
      const expanded = searching || !toggled.has(group.key)
      return {
        key: group.key,
        title: group.name,
        hint: null,
        kind: ESectionKind.Project,
        projectId: group.projectId,
        count: countOfGroup(group),
        expanded,
        gapBefore: index === 0 ? 0 : GROUP_GAP,
        data: expanded ? rowsOfGroup({ group, doneOpen }) : [],
      }
    })
  const bucket = ({
    kind,
    title,
    hint,
    groups,
  }: {
    kind: ESectionKind
    title: string
    hint: string | null
    groups: readonly IProjectGroup[]
  }): ISessionSection => {
    const kept = groups
      .map((group) => filterGroup({ group, needle }))
      .filter((group) => group.sessions.length > 0)
    const expanded = searching || toggled.has(kind)
    return {
      key: kind,
      title,
      hint,
      kind,
      projectId: null,
      count: kept.reduce((total, group) => total + countOfGroup(group), 0),
      expanded,
      gapBefore: 0,
      data: expanded
        ? kept.flatMap((group) => [
            {
              kind: EItemKind.ProjectLabel,
              key: `${kind}:${group.key}`,
              name: group.name,
            } as const,
            ...rowsOfGroup({ group, doneOpen }),
          ])
        : [],
    }
  }
  const tail = [
    bucket({
      kind: ESectionKind.Archived,
      title: 'Archived',
      hint: null,
      groups: partition.archived,
    }),
  ]
    .filter((section) => section.count > 0)
    .map((section, index) => ({
      ...section,
      gapBefore: index === 0 ? (projects.length > 0 ? GROUP_GAP : 0) : BUCKET_GAP,
    }))
  return [...projects, ...tail]
}
