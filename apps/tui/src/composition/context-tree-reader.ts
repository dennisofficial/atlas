import type { ContextReader } from '@dltech/atlas-harness'
import type { ContextTreeLevels } from '../ui/context-tree-model'

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

export async function readContextTree(args: {
  readers: Pick<ContextReader, 'list'>
  closed: ReadonlySet<string>
  previous: ContextTreeLevels
}): Promise<ContextTreeLevels> {
  const levels = new Map<string, { entries: Awaited<ReturnType<ContextReader['list']>>; error: string | null }>()
  const visit = async (directory: string): Promise<void> => {
    try {
      const entries = await args.readers.list(directory || undefined)
      levels.set(directory, { entries, error: null })
      await Promise.all(entries.filter((entry) => entry.isDirectory).map(async (entry) => {
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (!args.closed.has(path)) await visit(path)
      }))
    } catch (cause) {
      levels.set(directory, { entries: args.previous.get(directory)?.entries ?? [], error: messageOf(cause) })
    }
  }
  await visit('')
  return levels
}

export function sameContextTreeLevels(args: { left: ContextTreeLevels; right: ContextTreeLevels }): boolean {
  if (args.left.size !== args.right.size) return false
  for (const [path, left] of args.left) {
    const right = args.right.get(path)
    if (right === undefined || left.error !== right.error || left.entries.length !== right.entries.length) return false
    if (left.entries.some((entry, index) => entry.name !== right.entries[index]?.name ||
      entry.isDirectory !== right.entries[index]?.isDirectory)) return false
  }
  return true
}
