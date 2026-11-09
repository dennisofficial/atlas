import { describe, expect, it } from 'bun:test'

import { type V2Event } from '@dltech/atlas-core'

import { event, fakeWorktrees, inWorktree, invoke, rig } from './worktree-rig'

describe('enter_worktree', () => {
  it('creates a branch and a worktree named by the tool', async () => {
    const worktrees = fakeWorktrees()
    const { ctx } = rig({ worktrees: worktrees.port })
    const outcome = await invoke({ ctx, name: 'enter_worktree', input: { name: 'dennis/new' } })

    expect(outcome.ok).toBe(true)
    expect(worktrees.calls).toEqual([
      { method: 'create', args: { cwd: '/work', name: 'dennis/new' } },
    ])
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      enteredWorktree: {
        path: '/work/.atlas/worktrees/dennis/new',
        branch: 'dennis/new',
        base: 'origin/main',
      },
    })
  })

  it('refuses name and path together, and neither', async () => {
    const { ctx } = rig()
    const both = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { name: 'a', path: '/work/.atlas/worktrees/dennis/wt' },
    })
    const neither = await invoke({ ctx, name: 'enter_worktree', input: {} })

    expect(both.ok ? '' : both.reason).toContain('exactly one')
    expect(neither.ok ? '' : neither.reason).toContain('pass name')
  })

  it('enters an existing worktree by a path relative to the project directory', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '.atlas/worktrees/dennis/wt' },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      enteredWorktree: {
        path: '/work/.atlas/worktrees/dennis/wt',
        branch: 'dennis/wt',
        adopted: true,
      },
    })
  })

  it('treats a worktree this session spawned a child into as one Atlas created', async () => {
    const worktrees = fakeWorktrees()
    const spawnedInto = {
      type: 'agent-spawned',
      agentId: 'a1',
      agentType: 'general-purpose',
      intent: 'work the branch',
      mode: 'fresh',
      worktree: { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt' },
    } as unknown as V2Event
    const { ctx } = rig({ worktrees: worktrees.port, events: [spawnedInto] })

    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/wt' },
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({ enteredWorktree: { adopted: false } })
    expect(entered.modelText).toContain('which this session created')
  })

  it('treats a worktree the session entered itself as one Atlas created', async () => {
    const { ctx } = rig({
      events: [
        event({
          type: 'worktree-entered',
          path: '/work/.atlas/worktrees/dennis/wt',
          branch: 'dennis/wt',
          base: 'origin/main',
          adopted: false,
        }),
      ],
    })
    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/wt' },
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({
      enteredWorktree: { adopted: false, base: 'origin/main' },
    })
    expect(entered.modelText).toContain('which this session created')
  })

  it('keeps a worktree the session only adopted as one Atlas did not create', async () => {
    const { ctx } = rig({
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
            adopted: true,
          },
        }),
      ],
    })
    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/wt' },
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({ enteredWorktree: { adopted: true } })
    expect(entered.modelText).toContain('Atlas did not create it')
  })

  it('does not flip the worktree the session already stands in to adopted', async () => {
    const { ctx } = rig()
    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: inWorktree.path },
      projectDirectory: inWorktree.path,
      activeWorktree: inWorktree,
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({
      enteredWorktree: { adopted: false, base: 'origin/main' },
    })
  })

  it('normalises a trailing slash before matching a worktree git lists', async () => {
    const { ctx } = rig()
    const entered = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: `${inWorktree.path}/` },
    })

    expect(entered.ok).toBe(true)
    if (!entered.ok) throw new Error(entered.reason)
    expect(entered.output).toMatchObject({ enteredWorktree: { path: inWorktree.path } })
  })

  it('refuses the main checkout, a detached HEAD and a path git does not list', async () => {
    const { ctx } = rig()
    const main = await invoke({ ctx, name: 'enter_worktree', input: { path: '/work' } })
    const detached = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/.atlas/worktrees/dennis/detached' },
    })
    const stranger = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { path: '/work/elsewhere' },
    })

    expect(main.ok ? '' : main.reason).toContain('main checkout')
    expect(detached.ok ? '' : detached.reason).toContain('detached HEAD')
    expect(stranger.ok ? '' : stranger.reason).toContain('is not a worktree git lists')
  })

  it('refuses a second worktree while the session is in one', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'enter_worktree',
      input: { name: 'dennis/another' },
      activeWorktree: inWorktree,
    })

    expect(outcome.ok ? '' : outcome.reason).toContain('already in the worktree')
  })

  it('refuses a name git could not use', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'enter_worktree', input: { name: 'has spaces' } })
    expect(outcome.ok ? '' : outcome.reason).toContain('not a usable worktree name')
  })
})
