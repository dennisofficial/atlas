import { runGit } from './run-git'

const ORIGIN_PREFIX = 'origin/'
const HEAD_REF_LINE = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m

export const readOriginUrl = async (args: { cwd: string }): Promise<string | null> => {
  const run = await runGit({ args: ['remote', 'get-url', 'origin'], cwd: args.cwd })
  const url = run.ok ? run.stdout.trim() : ''
  return url === '' ? null : url
}

export const remoteDefaultBranch = async (args: { cwd: string }): Promise<string | null> => {
  const cached = await runGit({
    args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    cwd: args.cwd,
  })
  const named = cached.stdout.trim()
  if (cached.ok && named !== '')
    return named.startsWith(ORIGIN_PREFIX) ? named.slice(ORIGIN_PREFIX.length) : named

  const remote = await runGit({ args: ['ls-remote', '--symref', 'origin', 'HEAD'], cwd: args.cwd })
  if (!remote.ok) return null
  return HEAD_REF_LINE.exec(remote.stdout)?.[1] ?? null
}
