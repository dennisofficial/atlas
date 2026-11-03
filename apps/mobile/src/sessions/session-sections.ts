import type { ISessionEntry, ISessionPartition } from './session-groups'

export enum ESectionKind {
  Project = 'project',
  Inactive = 'inactive',
  Archived = 'archived',
}

export interface ISessionSection {
  key: string
  title: string
  kind: ESectionKind
  projectId: string | null
  count: number
  expanded: boolean
  data: ISessionEntry[]
}

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
  const keep = (entries: ISessionEntry[]) => entries.filter((entry) => matches({ entry, needle }))
  const projects = partition.groups
    .map((group) => {
      const data = keep(group.sessions)
      const expanded = searching || !toggled.has(group.key)
      return {
        key: group.key,
        title: group.name,
        kind: ESectionKind.Project,
        projectId: group.key,
        count: data.length,
        expanded,
        data: expanded ? data : [],
      }
    })
    .filter((section) => !searching || section.count > 0)
  const folded = (kind: ESectionKind, title: string, entries: ISessionEntry[]) => {
    const data = keep(entries)
    const expanded = searching || toggled.has(kind)
    return {
      key: kind,
      title,
      kind,
      projectId: null,
      count: data.length,
      expanded,
      data: expanded ? data : [],
    }
  }
  const tail = [
    folded(ESectionKind.Inactive, 'Inactive', partition.inactive),
    folded(ESectionKind.Archived, 'Archived', partition.archived),
  ].filter((section) => section.count > 0)
  return [...projects, ...tail]
}
