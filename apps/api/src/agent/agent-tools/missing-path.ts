import { basename, dirname } from 'node:path'

import type { AgentFileSystemPort, FileSystemEntry, ThreadId } from '@dltech/atlas-core'

const MAX_SUGGESTIONS = 8
const MAX_ENTRY_LENGTH = 80

type PathPort = {
  files: AgentFileSystemPort
  threadId: ThreadId
}

function nameDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let row = 1; row <= a.length; row++) {
    const current: number[] = [row]
    for (let column = 1; column <= b.length; column++) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1)
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        substitution,
      )
    }
    previous = current
  }

  return previous[b.length] ?? 0
}

async function isDirectory(args: PathPort & { path: string }): Promise<boolean> {
  const stats = await args.files
    .stat({ path: args.path, threadId: args.threadId })
    .catch(() => null)
  return stats?.isDirectory() === true
}

async function deepestExistingDirectoryOf(
  args: PathPort & { path: string },
): Promise<string | undefined> {
  let candidate = dirname(args.path)

  for (;;) {
    if (await isDirectory({ ...args, path: candidate })) return candidate

    const parent = dirname(candidate)
    if (parent === candidate) return undefined
    candidate = parent
  }
}

async function closestEntriesOf(
  args: PathPort & { directory: string; target: string },
): Promise<string[]> {
  const entries = await args.files
    .readDirectory({ path: args.directory, threadId: args.threadId })
    .catch((): readonly FileSystemEntry[] => [])
  const wanted = args.target.toLowerCase()

  return entries
    .map((entry) => ({
      label: entry.isDirectory() ? `${entry.name}/` : entry.name,
      distance: nameDistance(entry.name.toLowerCase(), wanted),
    }))
    .sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ label }) =>
      label.length > MAX_ENTRY_LENGTH ? `${label.slice(0, MAX_ENTRY_LENGTH)}…` : label,
    )
}

export async function missingPathReason(
  args: PathPort & {
    path: string
    resolvedFrom?: { raw: string; projectDirectory: string } | undefined
  },
): Promise<string> {
  const { path, resolvedFrom } = args
  const anchor =
    resolvedFrom === undefined
      ? ''
      : ` (${resolvedFrom.raw} resolved against the project directory ${resolvedFrom.projectDirectory})`

  const directory = await deepestExistingDirectoryOf(args)
  if (directory === undefined) return `File does not exist: ${path}${anchor}`

  const entries = await closestEntriesOf({ ...args, directory, target: basename(path) })
  const listing =
    entries.length === 0 ? 'It is empty.' : `Its closest entries are: ${entries.join(', ')}`

  return directory === dirname(path)
    ? `File does not exist: ${path}${anchor}. ${directory} is there. ${listing}`
    : `File does not exist: ${path}${anchor}. ${directory} is the deepest directory that exists on that path. ${listing}`
}
