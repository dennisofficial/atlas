import { describe, expect, it } from 'bun:test'

import { ExecutionLocationFragment } from '../fragments/environment'

describe('execution-location fragment', () => {
  it('states that the session runs in a pod or sandbox so the model never guesses from a path', () => {
    expect(new ExecutionLocationFragment().text()).toContain('running in a pod or a Vercel sandbox')
  })

  it('explains sibling cloning and ephemeral cloud workspaces', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).toContain('/atlas/workspaces/<repo-name>')
    expect(text).toContain('Clone additional repositories beside it')
    expect(text).toContain('Adjacent clones are ephemeral')
    expect(text).toContain('sandbox cleanup deletes them')
  })

  it('tells the model gitignored content does not reach a cloud sandbox and to install on demand', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).toContain('Gitignored content')
    expect(text).toContain('does not reach a cloud sandbox')
    expect(text).toContain("project's own install")
  })

  it('no longer describes the retired lift/descend machinery', () => {
    const text = new ExecutionLocationFragment().text()
    expect(text).not.toContain('Lift and descend')
    expect(text).not.toContain('descend leaves them behind')
  })
})
