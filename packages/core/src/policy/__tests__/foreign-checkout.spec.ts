import { describe, expect, it } from 'bun:test'

import { foreignCheckoutDenial } from '../foreign-checkout'

const MAIN = '/Users/dennis/Developer/atlas'
const WORKTREE = `${MAIN}/.atlas/worktrees/highlight-loop`

describe('foreignCheckoutDenial', () => {
  it('denies a write from the main checkout into a sibling worktree', () => {
    const target = `${MAIN}/.atlas/worktrees/cheap-shimmer/apps/tui/src/ui/shimmer.ts`

    const reason = foreignCheckoutDenial({ path: target, projectDirectory: MAIN })

    expect(reason).toContain(target)
    expect(reason).toContain(MAIN)
    expect(reason).toContain('enter_worktree')
  })

  it('denies a write from one worktree into another', () => {
    const target = `${MAIN}/.atlas/worktrees/cheap-shimmer/src/index.ts`

    expect(
      foreignCheckoutDenial({ path: target, projectDirectory: WORKTREE }),
    ).toBeDefined()
  })

  it('denies a relative path that escapes into a worktree through ..', () => {
    expect(
      foreignCheckoutDenial({
        path: '../comp-v3/.atlas/worktrees/secret-sync/src/x.ts',
        projectDirectory: MAIN,
      }),
    ).toBeDefined()
  })

  it('denies a write into any .git directory', () => {
    expect(
      foreignCheckoutDenial({
        path: '/Users/dennis/Developer/comp-v3/.git/hooks/pre-commit',
        projectDirectory: MAIN,
      }),
    ).toBeDefined()
  })

  it('allows ordinary writes inside the project directory', () => {
    expect(
      foreignCheckoutDenial({ path: `${MAIN}/packages/core/src/index.ts`, projectDirectory: MAIN }),
    ).toBeUndefined()
    expect(
      foreignCheckoutDenial({ path: 'packages/core/src/index.ts', projectDirectory: MAIN }),
    ).toBeUndefined()
  })

  it('allows writes inside the session worktree even though its path contains worktrees', () => {
    expect(
      foreignCheckoutDenial({
        path: `${WORKTREE}/apps/tui/src/main.tsx`,
        projectDirectory: WORKTREE,
      }),
    ).toBeUndefined()
    expect(
      foreignCheckoutDenial({ path: 'apps/tui/src/main.tsx', projectDirectory: WORKTREE }),
    ).toBeUndefined()
  })

  it('allows writes to the project directory itself', () => {
    expect(
      foreignCheckoutDenial({ path: WORKTREE, projectDirectory: WORKTREE }),
    ).toBeUndefined()
  })

  it('allows outside-project writes with no checkout segment, leaving them to the notice', () => {
    expect(
      foreignCheckoutDenial({
        path: '/Users/dennis/Developer/comp-v3/apps/web/src/page.tsx',
        projectDirectory: MAIN,
      }),
    ).toBeUndefined()
  })

  it('allows temporary roots and personal dot paths even with a checkout segment', () => {
    for (const path of [
      '/tmp/worktrees/scratch/x.ts',
      '/Users/dennis/.config/worktrees/settings.json',
    ]) {
      expect(foreignCheckoutDenial({ path, projectDirectory: MAIN })).toBeUndefined()
    }
  })
})
