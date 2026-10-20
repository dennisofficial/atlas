import { describe, expect, it } from 'bun:test'

import { bootstrapSpecOf } from '../local-cloud-bootstrap'

describe('bootstrapSpecOf', () => {
  it('writes the legacy shape when no project id is given', () => {
    const spec = JSON.parse(
      bootstrapSpecOf({ workspace: { remoteUrl: 'git@github.com:comp-ai/atlas.git' }, gitToken: 'tok' }),
    )

    expect(spec).toEqual({ remoteUrl: 'git@github.com:comp-ai/atlas.git', githubToken: 'tok' })
  })

  it('writes the project id alongside the model when one is given', () => {
    const spec = JSON.parse(
      bootstrapSpecOf({ workspace: null, gitToken: undefined, model: 'claude-x', projectId: 'proj-1' }),
    )

    expect(spec).toEqual({ remoteUrl: null, githubToken: null, projectId: 'proj-1', model: 'claude-x' })
  })
})
