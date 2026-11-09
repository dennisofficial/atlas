import { describe, expect, it } from 'bun:test'

import { EWorktreeExit } from '@dltech/atlas-core'

import {
  aheadState,
  dirtyState,
  event,
  fakeWorktrees,
  inWorktree,
  invoke,
  rig,
  unknownPushState,
} from './worktree-rig'

describe('exit_worktree', () => {
  it('says so and changes nothing when the session is not in a worktree', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({ ctx, name: 'exit_worktree', input: { action: 'keep' } })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({ exited: false })
    expect(worktrees.calls).toEqual([])
  })

  it('leaves the worktree on disk on keep', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'keep' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      exitedWorktree: { path: inWorktree.path, action: EWorktreeExit.Keep, returnTo: '/work' },
    })
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('removes the worktree and its branch when it is clean', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'remove',
      args: {
        cwd: '/work',
        path: inWorktree.path,
        branch: 'dennis/wt',
        force: false,
      },
    })
  })

  it('carries the base a child worktree was spawned with into the exit refusal', async () => {
    const worktrees = fakeWorktrees({ state: unknownPushState })
    const { ctx } = rig({
      worktrees: worktrees.port,
      events: [
        event({
          type: 'agent-spawned',
          agentId: 'a1',
          agentType: 'general-purpose',
          intent: 'work the branch',
          mode: 'spawn',
          worktree: {
            path: '/work/.atlas/worktrees/dennis/wt',
            branch: 'dennis/wt',
            base: 'origin/main',
          },
        }),
      ],
    })
    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/wt' },
    })
    if (!entered.ok) throw new Error(entered.reason)

    const exited = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(entered.output).toMatchObject({ enteredWorktree: { base: 'origin/main' } })
    expect(worktrees.calls).toContainEqual({
      method: 'inspect',
      args: { cwd: inWorktree.path, base: 'origin/main' },
    })
    expect(exited.ok ? '' : exited.reason).toContain('cannot tell what is not pushed')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('refuses to remove when it cannot tell what is not pushed', async () => {
    const worktrees = fakeWorktrees({ state: unknownPushState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('cannot tell what is not pushed')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('names the commits a removal would lose', async () => {
    const worktrees = fakeWorktrees({ state: aheadState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('1 commit that is not on origin/main')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('refuses to remove a dirty worktree and names what would be lost', async () => {
    const worktrees = fakeWorktrees({ state: dirtyState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('would lose 1 uncommitted file (src/a.ts)')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })

  it('removes a dirty worktree only when discardChanges is set', async () => {
    const worktrees = fakeWorktrees({ state: dirtyState })
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove', discardChanges: true },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toContainEqual({
      method: 'remove',
      args: { cwd: '/work', path: inWorktree.path, branch: 'dennis/wt', force: true },
    })
  })

  it('never removes a worktree Atlas only adopted', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({
      ctx,
      name: 'exit_worktree',
      input: { action: 'remove' },
      projectDirectory: inWorktree.path,
      activeWorktree: { ...inWorktree, adopted: true },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.modelText).toContain('Atlas did not create it')
    expect(worktrees.calls.some((call) => call.method === 'remove')).toBe(false)
  })
})
