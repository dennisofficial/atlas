import { describe, expect, it } from 'bun:test'

import { bootstrapSpecOf } from '../local-cloud-bootstrap'

describe('bootstrapSpecOf', () => {
  it('writes a null project id for a workspace-less session', () => {
    const spec = JSON.parse(bootstrapSpecOf({ projectId: null }))

    expect(spec).toEqual({ remoteUrl: null, githubToken: null, projectId: null })
  })

  it('writes the project id alongside the model when one is given', () => {
    const spec = JSON.parse(bootstrapSpecOf({ model: 'claude-x', projectId: 'proj-1' }))

    expect(spec).toEqual({
      remoteUrl: null,
      githubToken: null,
      projectId: 'proj-1',
      model: 'claude-x',
    })
  })

  it('writes the birth effort alongside the model when one is given', () => {
    const spec = JSON.parse(
      bootstrapSpecOf({ projectId: 'proj-1', model: 'claude-x', effort: 'high' }),
    )

    expect(spec).toMatchObject({ model: 'claude-x', effort: 'high' })
  })

  it('omits effort when the birth did not set one', () => {
    const spec = JSON.parse(bootstrapSpecOf({ projectId: null }))

    expect(spec).not.toHaveProperty('effort')
  })
})
