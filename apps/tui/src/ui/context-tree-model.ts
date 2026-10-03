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
  expanded: ReadonlySet<string>
}): readonly ContextTreeRow[] {
  const rows: ContextTreeRow[] = []
  const visit = ({ directory, depth }: { directory: string; depth: number }) => {
    for (const entry of sortContextEntries(args.levels.get(directory)?.entries ?? [])) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      const expanded = entry.isDirectory && args.expanded.has(path)
      rows.push({ ...entry, path, depth, expanded })
      if (expanded) visit({ directory: path, depth: depth + 1 })
    }
  }
  visit({ directory: '', depth: 0 })
  return rows
}

export function parentContextPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

export function toggleContextExpanded(args: { expanded: ReadonlySet<string>; path: string }): ReadonlySet<string> {
  const next = new Set(args.expanded)
  if (next.has(args.path)) next.delete(args.path)
  else next.add(args.path)
  return next
}

export function contextTreeSelection(args: {
  rows: readonly ContextTreeRow[]
  selected: string | null
}): string | null {
  let selected = args.selected
  while (selected !== null && selected !== '') {
    if (args.rows.some((row) => row.path === selected)) return selected
    selected = parentContextPath(selected)
  }
  return args.rows[0]?.path ?? null
}

export function moveContextSelection(args: {
  rows: readonly ContextTreeRow[]
  selected: string | null
  delta: number
}): string | null {
  if (args.rows.length === 0) return null
  const selected = contextTreeSelection(args)
  const index = Math.max(0, args.rows.findIndex((row) => row.path === selected))
  return args.rows[Math.max(0, Math.min(args.rows.length - 1, index + args.delta))]?.path ?? null
}
