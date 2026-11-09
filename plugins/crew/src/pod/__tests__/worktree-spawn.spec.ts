import { describe, expect, it } from 'bun:test'

import { fakeCrew, fakeWorktrees, inWorktree, invoke, rig } from './worktree-rig'

describe('agent_spawn with a worktree', () => {
  it('creates the named worktree and spawns the child into it', async () => {
    const crew = fakeCrew()
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ crew: crew.port, worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: 'dennis/child',
      },
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'create',
      args: { cwd: '/work', name: 'dennis/child' },
    })
    const spawn = crew.calls.find((call) => call.method === 'spawn')
    expect(spawn?.args).toMatchObject({
      worktree: {
        path: '/work/.atlas/worktrees/dennis/child',
        branch: 'dennis/child',
        base: 'origin/main',
      },
    })
    expect(outcome.ok ? outcome.modelText : '').toContain(
      'It works in /work/.atlas/worktrees/dennis/child on branch dennis/child.',
    )
  })

  it('adopts an existing worktree when the argument matches one git lists', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: '/work/.atlas/worktrees/dennis/wt',
      },
    })

    expect(outcome.ok).toBe(true)
    const spawn = crew.calls.find((call) => call.method === 'spawn')
    expect(spawn?.args).toMatchObject({
      worktree: { path: '/work/.atlas/worktrees/dennis/wt', adopted: true },
    })
  })

  it('creates a worktree for the child while the parent is already in one', async () => {
    const crew = fakeCrew()
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ crew: crew.port, worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: 'dennis/child',
      },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'create',
      args: { cwd: inWorktree.path, name: 'dennis/child' },
    })
  })

  it('refuses an absolute path git does not list instead of creating a branch', async () => {
    const crew = fakeCrew()
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ crew: crew.port, worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: '/work/elsewhere',
      },
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('not a usable worktree name')
    expect(worktrees.calls.some((call) => call.method === 'create')).toBe(false)
    expect(crew.calls).toEqual([])
  })

  it('refuses to spawn when the worktree cannot be entered', async () => {
    const crew = fakeCrew()
    const { ctx } = rig({ crew: crew.port })
    const outcome = await invoke({
      ctx,
      name: 'agent_spawn',
      input: {
        agentType: 'general-purpose',
        intent: 'work the branch',
        brief: 'Do the thing.',
        worktree: '/work',
      },
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('main checkout')
    expect(crew.calls).toEqual([])
  })
})
