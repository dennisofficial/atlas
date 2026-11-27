import { resolve } from 'node:path'

import { EProcessOutcome, outcomeOf, type ProcessPort } from '@dltech/atlas-core'

const CHECK_IGNORE_OVER_STDIN = 'printf "%s\\0" "$@" | git check-ignore --stdin -z'

export type RepositoryFacts = {
  inWorkTree: boolean
  tracked: ReadonlySet<string> | null
  ignored: ReadonlySet<string> | null
  excludeFile: string | null
}

type GitRun = { code: number; stdout: string }

const runIn = async (args: {
  processes: ProcessPort
  cwd: string
  cmd: readonly string[]
  signal?: AbortSignal | undefined
}): Promise<GitRun> => {
  const handle = args.processes.spawn({ cmd: args.cmd, cwd: args.cwd })
  args.signal?.addEventListener('abort', () => handle.terminate(), { once: true })
  const [outcome, stdout] = await Promise.all([
    outcomeOf(handle),
    new Response(handle.stdout).text(),
    new Response(handle.stderr).text(),
  ])
  return { code: outcome.kind === EProcessOutcome.Exited ? outcome.code : -1, stdout }
}

const pathSetOf = (stdout: string): ReadonlySet<string> =>
  new Set(stdout.split('\0').filter((entry) => entry !== ''))

export const isTracked = (args: { tracked: ReadonlySet<string>; path: string }): boolean =>
  args.tracked.has(args.path) ||
  [...args.tracked].some((entry) => entry.startsWith(`${args.path}/`))

export const repositoryFactsOf = async (args: {
  processes: ProcessPort
  root: string
  relativePaths: readonly string[]
  signal?: AbortSignal | undefined
}): Promise<RepositoryFacts> => {
  const run = (cmd: readonly string[]): Promise<GitRun> =>
    runIn({ processes: args.processes, cwd: args.root, cmd, signal: args.signal })
  const [inside, tracked, ignored, exclude] = await Promise.all([
    run(['git', 'rev-parse', '--is-inside-work-tree']),
    run(['git', '--literal-pathspecs', 'ls-files', '-z', '--', ...args.relativePaths]),
    run(['sh', '-c', CHECK_IGNORE_OVER_STDIN, 'sh', ...args.relativePaths]),
    run(['git', 'rev-parse', '--git-path', 'info/exclude']),
  ])
  const excludePath = exclude.stdout.trim()
  return {
    inWorkTree: inside.code === 0,
    tracked: tracked.code === 0 ? pathSetOf(tracked.stdout) : null,
    ignored: ignored.code === 0 || ignored.code === 1 ? pathSetOf(ignored.stdout) : null,
    excludeFile: exclude.code === 0 && excludePath !== '' ? resolve(args.root, excludePath) : null,
  }
}
