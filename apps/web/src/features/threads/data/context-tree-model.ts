import type { ContextEntry, ContextLevel } from './context-files-source'

export type ContextLevels = ReadonlyMap<string, ContextLevel>
export type ContextRow = ContextEntry & {
  path: string
  depth: number
  open: boolean
}

const sorted = (entries: readonly ContextEntry[]): ContextEntry[] =>
  [...entries].sort((left, right) => {
    const folders = Number(right.isDirectory) - Number(left.isDirectory)
    if (folders !== 0) return folders
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })

export function contextRowsOf(args: {
  levels: ContextLevels
  opened: ReadonlySet<string>
}): ContextRow[] {
  const rows: ContextRow[] = []
  const visit = (directory: string, depth: number): void => {
    for (const entry of sorted(args.levels.get(directory)?.entries ?? [])) {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`
      const open = entry.isDirectory && args.opened.has(path)
      rows.push({ ...entry, path, depth, open })
      if (open) visit(path, depth + 1)
    }
  }
  visit('', 0)
  return rows
}

export enum EContextStatus {
  Loading = 'loading',
  Unavailable = 'unavailable',
  Empty = 'empty',
  Ready = 'ready',
}

export function contextStatusOf(args: {
  levels: ContextLevels
  rows: number
  connected: boolean
}): EContextStatus {
  if (args.rows > 0) return EContextStatus.Ready
  if (!args.connected) return EContextStatus.Unavailable
  const root = args.levels.get('')
  if (root === undefined) return EContextStatus.Loading
  return root.error ? EContextStatus.Unavailable : EContextStatus.Empty
}

export const CONTEXT_INDENT_PX = 12

export const contextIndentOf = (depth: number): number => Math.max(0, depth) * CONTEXT_INDENT_PX
