import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runGit } from '../../workspace/run-git'
import { createWorkspacePublisher } from '../publish-workspace'

import { commitAll, git, headOf, refsIn, scenario, specOf, THREAD } from './publish-workspace-fixture'

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

    const head = await headOf(sandbox)
    expect(published.commit).not.toBe(head)
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
    expect(parent.stdout.trim()).toBe(head)
  })

  it('carries the recorded baseline tree as the pushed commit’s second parent', async () => {
    const { remote, sandbox, lifted } = await scenario()
    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected a published ref')

    const secondParentTree = await runGit({
      args: ['--git-dir', remote, 'rev-parse', `${published.commit}^2^{tree}`],
      cwd: sandbox,
    })
    if (published.baseTree === null) throw new Error('expected a recorded baseline tree')
    expect(secondParentTree.stdout.trim()).toBe(published.baseTree)
    expect(published.baseTree).toBe(
      (await git(sandbox, ['rev-parse', `${lifted}^{tree}`])).stdout.trim(),
    )
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
    const parent = await runGit({
      args: ['--git-dir', remote, 'rev-parse', `${published.commit}^`],
      cwd: sandbox,
    })
    expect(parent.stdout.trim()).toBe(await headOf(sandbox))
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

  it('carries the sentinel’s branch and baseline tree down with the publish', async () => {
    const { remote, sandbox, lifted } = await scenario()
    await git(sandbox, ['checkout', '-B', 'dennis/feature', lifted])
    const tree = (await git(sandbox, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    writeFileSync(
      join(sandbox, '.git', 'atlas-materialized'),
      JSON.stringify({
        at: '2026-09-22T00:00:00.000Z',
        commit: lifted,
        baseline: lifted,
        baselineTree: tree,
        branch: 'dennis/feature',
      }),
    )
    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted, branch: 'dennis/feature' }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the cloud work to publish')
    expect(published.base).toBe(lifted)
    expect(published.baseTree).toBe(tree)
    expect(published.branch).toBe('dennis/feature')
  })

  it('publishes after the agent rewrote history, keyed on the sentinel’s recorded tree', async () => {
    const { remote, sandbox, lifted } = await scenario()
    const tree = (await git(sandbox, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    writeFileSync(
      join(sandbox, '.git', 'atlas-materialized'),
      JSON.stringify({
        at: '2026-09-22T00:00:00.000Z',
        commit: lifted,
        baseline: lifted,
        baselineTree: tree,
        branch: 'dennis/feature',
      }),
    )
    await git(sandbox, ['checkout', '-B', 'dennis/feature', lifted])
    writeFileSync(join(sandbox, 'rewritten.ts'), 'export const rewritten = true\n')
    await commitAll(sandbox, 'a clean commit atop a rewritten history')
    await git(sandbox, ['reset', '--soft', 'HEAD^'])
    await commitAll(sandbox, 'rewritten again')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted, branch: 'dennis/feature' }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the rewritten work to publish')
    expect(published.baseTree).toBe(tree)
    expect(await refsIn(remote)).toContain(published.ref)
  })

  it('derives the baseline tree from the commit for a sentinel written before trees existed', async () => {
    const { remote, sandbox, lifted } = await scenario()
    writeFileSync(
      join(sandbox, '.git', 'atlas-materialized'),
      JSON.stringify({ at: '2026-09-18T00:00:00.000Z', commit: lifted, baseline: lifted }),
    )
    writeFileSync(join(sandbox, 'cloud-note.txt'), 'written in the cloud\n')

    const publish = createWorkspacePublisher({
      threadId: THREAD,
      fetchSpec: async () => specOf({ remoteUrl: remote, commit: lifted }),
    })

    const published = await publish({ cwd: sandbox })
    if (published === null) throw new Error('expected the cloud work to publish')
    expect(published.baseTree).toBe(
      (await git(sandbox, ['rev-parse', `${lifted}^{tree}`])).stdout.trim(),
    )
    expect(published.branch).toBeNull()
  })
})
