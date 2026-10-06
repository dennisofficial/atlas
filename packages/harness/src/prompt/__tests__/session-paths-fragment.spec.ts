import { describe, expect, it } from 'bun:test'

import { SessionPathsFragment } from '../fragments/environment'

describe('SessionPathsFragment', () => {
  const text = () => new SessionPathsFragment().text()

  it('names all three session path variables', () => {
    const compiled = text()
    expect(compiled).toContain('ATLAS_SESSION_DIR')
    expect(compiled).toContain('ATLAS_CONTEXT_DIR')
    expect(compiled).toContain('ATLAS_THREAD_DIR')
  })

  it('assigns scratch, private thread files, and session coordination each its directory', () => {
    const compiled = text()
    expect(compiled).toContain('temporary probes')
    expect(compiled).toContain('$ATLAS_SESSION_DIR/scratch')
    expect(compiled).toContain('Keep private scratch under ATLAS_THREAD_DIR')
    expect(compiled).toContain('coordination notes')
    expect(compiled).toContain('ATLAS_CONTEXT_DIR')
  })

  it('leaves repository worktree mechanics to the worktree tool contract', () => {
    const compiled = text()
    expect(compiled).not.toContain('source changes and Git worktrees')
    expect(compiled).not.toContain('worktree configuration and instructions')
  })

  it('states that session directories move with the session across cloud lifts', () => {
    expect(text()).toContain('move with it across cloud lifts')
  })
})
