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
  count: number
  expanded: boolean
  data: ISessionEntry[]
}

const matches = ({ entry, query }: { entry: ISessionEntry; query: string }): boolean =>
  query.length === 0 ||
  entry.title.toLowerCase().includes(query) ||
  entry.projectName.toLowerCase().includes(query)

export const sectionsOf = ({
  partition,
  query,
  expanded,
}: {
  partition: ISessionPartition
  query: string
  expanded: ReadonlySet<ESectionKind>
}): ISessionSection[] => {
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const keep = (entries: ISessionEntry[]) =>
    entries.filter((entry) => matches({ entry, query: needle }))
  const projects = partition.groups
    .map((group) => {
      const data = keep(group.sessions)
      return {
        key: group.key,
        title: group.name,
        kind: ESectionKind.Project,
        count: data.length,
        expanded: true,
        data,
      }
    })
    .filter((section) => !searching || section.count > 0)
  const folded = (kind: ESectionKind, title: string, entries: ISessionEntry[]) => {
    const data = keep(entries)
    const open = searching || expanded.has(kind)
    return { key: kind, title, kind, count: data.length, expanded: open, data: open ? data : [] }
  }
  const tail = [
    folded(ESectionKind.Inactive, 'Inactive', partition.inactive),
    folded(ESectionKind.Archived, 'Archived', partition.archived),
  ].filter((section) => section.count > 0)
  return [...projects, ...tail]
}
