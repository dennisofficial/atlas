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
  | { kind: EItemKind.Session; key: string; entry: ISessionEntry }
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

const sessionItem = (entry: ISessionEntry): SectionItem => ({
  kind: EItemKind.Session,
  key: entry.id,
  entry,
})

const matches = ({ entry, needle }: { entry: ISessionEntry; needle: string }): boolean =>
  needle.length === 0 ||
  entry.title.toLowerCase().includes(needle) ||
  entry.projectName.toLowerCase().includes(needle)

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
  const filtered = (group: IProjectGroup): IProjectGroup => ({
    ...group,
    sessions: group.sessions.filter((entry) => matches({ entry, needle })),
  })
  const projects = partition.groups
    .map(filtered)
    .filter((group) => !searching || group.sessions.length > 0)
    .map((group, index) => {
      const expanded = searching || !toggled.has(group.key)
      return {
        key: group.key,
        title: group.name,
        hint: null,
        kind: ESectionKind.Project,
        projectId: group.projectId,
        count: group.sessions.length,
        expanded,
        gapBefore: index === 0 ? 0 : GROUP_GAP,
        data: expanded ? group.sessions.map(sessionItem) : [],
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
    const kept = groups.map(filtered).filter((group) => group.sessions.length > 0)
    const expanded = searching || toggled.has(kind)
    return {
      key: kind,
      title,
      hint,
      kind,
      projectId: null,
      count: kept.reduce((total, group) => total + group.sessions.length, 0),
      expanded,
      gapBefore: 0,
      data: expanded
        ? kept.flatMap((group) => [
            {
              kind: EItemKind.ProjectLabel,
              key: `${kind}:${group.key}`,
              name: group.name,
            } as const,
            ...group.sessions.map(sessionItem),
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
