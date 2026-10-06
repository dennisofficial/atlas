import { describe, expect, it } from 'bun:test'

import { ExecutionLocationFragment } from '../fragments/environment'

describe('stable execution topology', () => {
  it('describes local host/Docker execution and the remote harness', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).toContain('Atlas runs locally or in cloud.')
    expect(text).toContain('commands and file operations on the host or in Docker')
    expect(text).toContain('harness and execution in a Vercel sandbox')
    expect(text).toContain('terminal is a client')
  })

  it('explains sibling cloning without promising multi-repository transfers', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).toContain('/atlas/workspaces/<repo-name>')
    expect(text).toContain('Clone additional repositories beside it')
    expect(text).toContain('explicit workdir or absolute paths')
    expect(text).toContain('only the primary repository and its session worktree')
    expect(text).toContain('Adjacent clones are ephemeral')
    expect(text).toContain('sandbox cleanup deletes them')
  })

  it('keeps current placement and preview procedures outside system text', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).not.toContain('This session')
    expect(text).not.toContain('execution_location')
    expect(text).not.toContain('sandbox.localhost')
    expect(text).not.toContain('cookies')
    expect(text).not.toContain('Commit freely')
    expect(text.length).toBeLessThan(750)
  })
})
