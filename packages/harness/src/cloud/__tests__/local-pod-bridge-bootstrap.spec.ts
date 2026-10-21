import { describe, expect, it } from 'vitest'

import { bootstrapSpecOf } from '../local-cloud-bootstrap'

describe('bootstrapSpecOf', () => {
  it('writes a null project id for a workspace-less session', () => {
    const spec = JSON.parse(bootstrapSpecOf({ projectId: null }))

    expect(spec).toEqual({ remoteUrl: null, githubToken: null, projectId: null })
  })

  it('writes the project id alongside the model when one is given', () => {
    const spec = JSON.parse(
      bootstrapSpecOf({ model: 'claude-x', projectId: 'proj-1' }),
    )

    expect(spec).toEqual({ remoteUrl: null, githubToken: null, projectId: 'proj-1', model: 'claude-x' })
  })
})
