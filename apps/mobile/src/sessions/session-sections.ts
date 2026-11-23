import type { IProjectGroup, ISessionEntry, ISessionPartition } from './session-groups'

export enum ESectionKind {
  Project = 'project',
  Inactive = 'inactive',
  Archived = 'archived',
}

export enum EItemKind {
  Session = 'session',
  ProjectLabel = 'project-label',
}

export type SectionItem =
  | { kind: EItemKind.Session; key: string; entry: ISessionEntry; depth: number }
  | { kind: EItemKind.ProjectLabel; key: string; name: string }

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

const rowsOf = ({ entry, depth }: { entry: ISessionEntry; depth: number }): SectionItem[] => [
  { kind: EItemKind.Session, key: entry.id, entry, depth },
  ...entry.children.flatMap((child) => rowsOf({ entry: child, depth: depth + 1 })),
]

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

const rowsOfGroup = (group: IProjectGroup): SectionItem[] =>
  group.sessions.flatMap((entry) => rowsOf({ entry, depth: 0 }))

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
        data: expanded ? rowsOfGroup(group) : [],
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
            ...rowsOfGroup(group),
          ])
        : [],
    }
  }
  const tail = [
    bucket({
      kind: ESectionKind.Inactive,
      title: 'Inactive',
      hint: 'Last 72h',
      groups: partition.inactive,
    }),
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
