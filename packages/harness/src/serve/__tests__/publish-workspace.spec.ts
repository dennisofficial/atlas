import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { runGit, type GitRun } from '../../workspace/run-git'
import { createWorkspacePublisher } from '../publish-workspace'
import type { WorkspaceSpec } from '../workspace-spec'

const THREAD = toThreadId('brn_publish-spec')

const git = async (cwd: string, args: readonly string[]): Promise<GitRun> => {
  const run = await runGit({ args, cwd })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run
}

const commitAll = async (cwd: string, message: string): Promise<void> => {
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

const headOf = async (cwd: string): Promise<string> =>
  (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()

const refsIn = async (remote: string): Promise<string> =>
  (await runGit({ args: ['ls-remote', '--', remote], cwd: remote })).stdout

const scenario = async (): Promise<{ remote: string; sandbox: string; lifted: string }> => {
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

const specOf = (partial: Partial<WorkspaceSpec>): WorkspaceSpec => ({
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
  ...partial,
})

describe('createWorkspacePublisher', () => {
  it('commits the sandbox tree and pushes it to a content-addressed scratch ref', async () => {
    const { remote, sandbox, lifted } = await scenario()
    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')
    writeFileSync(join(sandbox, 'app.ts'), 'export const one = 1\nexport const two = 2\n')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected a published ref')

    expect(published.commit).toBe(await headOf(sandbox))
    expect(published.base).toBe(lifted)
    expect(published.ref).toBe(`refs/atlas/descend/${THREAD}-${published.commit.slice(0, 12)}`)
    expect(await refsIn(remote)).toContain(published.ref)

    const note = await runGit({
      args: ['--git-dir', remote, 'cat-file', '-p', `${published.commit}:cloud-note.txt`],
      cwd: sandbox,
    })
    expect(note.stdout).toBe('written in the cloud\n')

    const parent = await runGit({
      args: ['--git-dir', remote, 'rev-parse', `${published.commit}^`],
      cwd: sandbox,
    })
    expect(parent.stdout.trim()).toBe(lifted)
  })

  it('sends nothing when the tree is clean at the lifted commit', async () => {
    const { remote, sandbox, lifted } = await scenario()

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    expect(await publish({ cwd: sandbox })).toBeNull()
    expect(await headOf(sandbox)).toBe(lifted)
    expect(await refsIn(remote)).not.toContain('refs/atlas/')
  })

  it('pushes work the agent itself committed, even with a clean tree', async () => {
    const { remote, sandbox, lifted } = await scenario()
    writeFileSync(join(sandbox, 'agent-work.ts'), 'export const committed = true\n')
    await commitAll(sandbox, 'agent commit')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the agent commit to publish')
    expect(published.commit).toBe(await headOf(sandbox))
    expect(await refsIn(remote)).toContain(published.ref)
  })

  it('takes the baseline the materialization recorded over the lifted commit', async () => {
    const { remote, sandbox, lifted } = await scenario()
    writeFileSync(join(sandbox, 'app.ts'), 'export const one = 1\nexport const lifted = true\n')
    await commitAll(sandbox, 'atlas: lifted workspace baseline')
    const baseline = await headOf(sandbox)
    writeFileSync(
      join(sandbox, '.git', 'atlas-materialized'),
      JSON.stringify({ at: '2026-09-18T00:00:00.000Z', commit: lifted, baseline }),
    )

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    expect(await publish({ cwd: sandbox })).toBeNull()

    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')
    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the cloud work to publish')
    expect(published.base).toBe(baseline)
  })

  it('sends nothing when the workspace has no remote to push to', async () => {
    const { sandbox } = await scenario()

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({}),
    })

    expect(await publish({ cwd: sandbox })).toBeNull()
  })

  it('scrubs the push token out of a failure', async () => {
    const { sandbox, lifted } = await scenario()
    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')
    const token = 'gho_spec-secret-token'

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () =>
        specOf({
          remoteUrl: 'https://localhost:1/nowhere/atlas.git',
          commit: lifted,
          githubToken: token,
        }),
    })

    const failure = await publish({ cwd: sandbox }).catch((error: unknown) => error)
    if (!(failure instanceof Error)) throw new Error('expected the push to fail')
    expect(failure.message).not.toContain(token)
  })
})
