import { describe, expect, it } from 'bun:test'

import { inWorktree, invoke, rig } from './worktree-rig'

describe('worktree_list', () => {
  it('marks the main checkout and the worktree the session stands in', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'worktree_list',
      input: {},
      projectDirectory: inWorktree.path,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(outcome.output).toEqual({
      repository: '/work',
      current: inWorktree.path,
      worktrees: [
        { path: '/work', branch: 'main', isMain: true },
        { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt', isMain: false },
        { path: '/work/.atlas/worktrees/dennis/detached', branch: null, isMain: false },
      ],
    })
    expect(outcome.modelText).toContain('/work on main (main checkout)')
    expect(outcome.modelText).toContain(
      '/work/.atlas/worktrees/dennis/wt on dennis/wt (this session)',
    )
  })
})
