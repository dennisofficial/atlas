import type { ProcessPort, ThreadId } from '@dltech/atlas-core'

const MAXIMUM_LINE_LENGTH = 500
const VERSION_CONTROL_DIRECTORIES = ['.git', '.svn', '.hg', '.jj', '.sl'] as const

export type Searcher = { name: string; command: readonly string[] }

export type SearchArguments = {
  pattern: string
  searchPath: string
  glob: string | undefined
  caseInsensitive: boolean
  context: number | undefined
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function ripgrepSearcher(args: SearchArguments & { binary: string }): Searcher {
  return {
    name: 'ripgrep',
    command: [
      args.binary,
      '--with-filename',
      '--hidden',
      '--follow',
      ...VERSION_CONTROL_DIRECTORIES.flatMap((directory) => ['--glob', `!${directory}`]),
      '--max-columns',
      String(MAXIMUM_LINE_LENGTH),
      '--line-number',
      ...(args.caseInsensitive ? ['--ignore-case'] : []),
      ...(args.context === undefined ? [] : ['--context', String(args.context)]),
      ...(args.glob === undefined ? [] : ['--glob', args.glob]),
      '--regexp',
      args.pattern,
      args.searchPath,
    ],
  }
}

export function searcherFor(args: SearchArguments & { binary: string }): Searcher {
  return ripgrepSearcher({ ...args })
}

export async function ripgrepBinaryOf(args: {
  processes: ProcessPort
  threadId: ThreadId
}): Promise<string | null> {
  if (args.processes.vendored !== undefined) {
    const vendored = await args.processes.vendored({ command: 'rg', threadId: args.threadId })
    if (vendored !== null) return vendored
  }
  return args.processes.which({ command: 'rg', threadId: args.threadId })
}
