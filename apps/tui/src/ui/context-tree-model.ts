import type { DirectoryEntry } from '@dltech/atlas-core'

export type ContextTreeLevel = { entries: readonly DirectoryEntry[]; error: string | null }
export type ContextTreeLevels = ReadonlyMap<string, ContextTreeLevel>
export type ContextTreeRow = DirectoryEntry & { path: string; depth: number; expanded: boolean }

export function sortContextEntries(entries: readonly DirectoryEntry[]): readonly DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const folders = Number(right.isDirectory) - Number(left.isDirectory)
    if (folders !== 0) return folders
    const named = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    if (named !== 0) return named
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  })
}

export function contextTreeRows(args: {
  levels: ContextTreeLevels
  closed: ReadonlySet<string>
}): readonly ContextTreeRow[] {
  const rows: ContextTreeRow[] = []
  const visit = ({ directory, depth }: { directory: string; depth: number }) => {
    for (const entry of sortContextEntries(args.levels.get(directory)?.entries ?? [])) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      const expanded = entry.isDirectory && !args.closed.has(path)
      rows.push({ ...entry, path, depth, expanded })
      if (expanded) visit({ directory: path, depth: depth + 1 })
    }
  }
  visit({ directory: '', depth: 0 })
  return rows
}

export function toggleContextClosed(args: { closed: ReadonlySet<string>; path: string }): ReadonlySet<string> {
  const next = new Set(args.closed)
  if (next.has(args.path)) next.delete(args.path)
  else next.add(args.path)
  return next
}
