import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { runGit, type GitRun } from '../../workspace/run-git'
import type { WorkspaceSpec } from '../workspace-spec'

export const THREAD = toThreadId('brn_publish-spec')

export const git = async (cwd: string, args: readonly string[]): Promise<GitRun> => {
  const run = await runGit({ args, cwd })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run
}

export const commitAll = async (cwd: string, message: string): Promise<void> => {
  await git(cwd, ['add', '-A'])
  await git(cwd, [
    '-c',
    'user.name=Spec',
    '-c',
    'user.email=spec@example.com',
    'commit',
    '-m',
    message,
  ])
}

export const headOf = async (cwd: string): Promise<string> =>
  (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()

export const refsIn = async (remote: string): Promise<string> =>
  (await runGit({ args: ['ls-remote', '--', remote], cwd: remote })).stdout

export const scenario = async (): Promise<{ remote: string; sandbox: string; lifted: string }> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-publish-'))
  const remote = join(root, 'remote.git')
  const seed = join(root, 'seed')
  const sandbox = join(root, 'sandbox')

  await git(root, ['init', '--bare', '--initial-branch=main', remote])
  await git(root, ['init', '--initial-branch=main', seed])
  writeFileSync(join(seed, 'app.ts'), 'export const one = 1\n')
  await commitAll(seed, 'lifted commit')
  await git(seed, ['remote', 'add', 'origin', remote])
  await git(seed, ['push', 'origin', 'HEAD:main'])
  const lifted = await headOf(seed)

  await git(root, ['clone', '--', remote, sandbox])
  await git(sandbox, ['checkout', '--detach', lifted])

  return { remote, sandbox, lifted }
}

export const specOf = (partial: Partial<WorkspaceSpec>): WorkspaceSpec => ({
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
  ...partial,
})
