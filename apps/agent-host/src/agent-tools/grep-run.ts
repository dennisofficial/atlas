import { EProcessOutcome, outcomeOf, type ProcessPort, type ThreadId } from '@dltech/atlas-core'
import { ECallFailure } from '@dltech/atlas-protocol'

import type { Searcher } from './grep-search'

export type SearchRun = { stdout: string; stderr: string; exitCode: number }

export async function runSearcher(args: {
  searcher: Searcher
  processes: ProcessPort
  cwd: string
  signal: AbortSignal
  threadId: ThreadId
}): Promise<SearchRun | undefined> {
  const search = args.processes.spawn({
    cmd: [...args.searcher.command],
    cwd: args.cwd,
    threadId: args.threadId,
  })
  const handleAbort = (): void => search.terminate()
  args.signal.addEventListener('abort', handleAbort, { once: true })
  try {
    const [stdout, stderr, outcome] = await Promise.all([
      new Response(search.stdout).text(),
      new Response(search.stderr).text(),
      outcomeOf(search),
    ])
    if (outcome.kind === EProcessOutcome.Failed && outcome.code === ECallFailure.SpawnFailed) {
      await search.exited.catch(() => undefined)
      return undefined
    }
    return { stdout, stderr, exitCode: await search.exited }
  } finally {
    args.signal.removeEventListener('abort', handleAbort)
  }
}
