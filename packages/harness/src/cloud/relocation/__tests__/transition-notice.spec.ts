import { describe, expect, it } from 'bun:test'

import { liftedProse, NOTHING_WAS_STOPPED } from '../transition-notice'

const workspace = {
  commit: 'abc123def456',
  branch: 'dennis/fix-lift-notice-scope',
  remoteUrl: 'git@github.com:dennisofficial/atlas.git',
  patch: '',
}

describe('liftedProse', () => {
  const prose = (): string => liftedProse({ workspace, stopped: NOTHING_WAS_STOPPED })

  it('states that only the active worktree and the main checkout travel, not every worktree', () => {
    const text = prose()
    expect(text).not.toContain('All worktrees')
    expect(text).toContain('Only the worktree this session runs in travels')
    expect(text).toContain('any other worktrees stay behind')
  })

  it('states that gitignored files are left behind rather than retained', () => {
    const text = prose()
    expect(text).not.toContain('ignored files retain their original state')
    expect(text).toContain('gitignored files')
    expect(text).toContain('left behind')
  })

  it('warns that missing remote-tracking refs do not mean a fresh clone', () => {
    expect(prose()).toContain('does not mean the checkout is a fresh clone')
  })

  it('omits the carry rule entirely when the destination holds no repository', () => {
    const text = liftedProse({ workspace: null, stopped: NOTHING_WAS_STOPPED })
    expect(text).toContain('no Git repository')
    expect(text).not.toContain('worktree this session runs in')
  })
})
