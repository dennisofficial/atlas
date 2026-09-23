import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createWorkspacePublisher } from '../publish-workspace'

import { commitAll, git, refsIn, scenario, specOf, THREAD } from './publish-workspace-fixture'

describe('createWorkspacePublisher refusals', () => {
  it('refuses the descend while a side branch holds commits the push would not carry', async () => {
    const { remote, sandbox, lifted } = await scenario()
    await git(sandbox, ['checkout', '-b', 'side-work'])
    writeFileSync(join(sandbox, 'side.ts'), 'export const side = true\n')
    await commitAll(sandbox, 'side branch commit')
    await git(sandbox, ['checkout', '--detach', lifted])

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const failure = await publish({ cwd: sandbox }).catch((error: unknown) => error)
    if (!(failure instanceof Error)) throw new Error('expected the publish to refuse')
    expect(failure.message).toContain('side-work')
    expect(failure.message).toContain('Nothing was sent home')
    expect(await refsIn(remote)).not.toContain('refs/atlas/')
  })

  it('publishes when a side branch is already an ancestor of HEAD', async () => {
    const { remote, sandbox, lifted } = await scenario()
    await git(sandbox, ['branch', 'old-work', lifted])
    writeFileSync(join(sandbox, 'agent-work.ts'), 'export const committed = true\n')
    await commitAll(sandbox, 'agent commit')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the agent commit to publish')
    expect(await refsIn(remote)).toContain(published.ref)
  })

  it('publishes when a side branch already lives on the remote', async () => {
    const { remote, sandbox, lifted } = await scenario()
    await git(sandbox, ['checkout', '-b', 'pushed-work'])
    writeFileSync(join(sandbox, 'pushed.ts'), 'export const pushed = true\n')
    await commitAll(sandbox, 'pushed branch commit')
    await git(sandbox, ['push', 'origin', 'HEAD:pushed-work'])
    await git(sandbox, ['checkout', '--detach', lifted])

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    expect(await publish({ cwd: sandbox })).toBeNull()
  })

  it('refuses the descend while a nested worktree holds uncommitted changes', async () => {
    const { remote, sandbox, lifted } = await scenario()
    const nested = join(sandbox, '.atlas', 'worktrees', 'nested')
    await git(sandbox, ['worktree', 'add', '--detach', nested, lifted])
    writeFileSync(join(nested, 'uncommitted.ts'), 'export const lost = true\n')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const failure = await publish({ cwd: sandbox }).catch((error: unknown) => error)
    if (!(failure instanceof Error)) throw new Error('expected the publish to refuse')
    expect(failure.message).toContain('worktree')
    expect(failure.message).toContain('uncommitted changes')
    expect(await refsIn(remote)).not.toContain('refs/atlas/')
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
