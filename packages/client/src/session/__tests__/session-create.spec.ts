import { describe, expect, it } from 'bun:test'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import { initialProjectIdOf, sessionCreateInputOf } from '../session-create'

const projects = [{ id: 'p1' }, { id: 'p2' }]

describe('sessionCreateInputOf', () => {
  it('sends only the first message when nothing else is chosen', () => {
    expect(sessionCreateInputOf({ firstMessage: { text: 'hello' } })).toEqual({
      firstMessage: { text: 'hello' },
    })
  })

  it('omits the project when the session runs without one', () => {
    const input = sessionCreateInputOf({ projectId: null, firstMessage: { text: 'hello' } })
    expect('projectId' in input).toBe(false)
  })

  it('carries the project, the model choice and the provider', () => {
    expect(
      sessionCreateInputOf({
        projectId: 'p1',
        model: 'anthropic/claude-opus-4',
        effort: 'high',
        fast: false,
        provider: ESandboxProvider.Agent37,
        firstMessage: { text: 'hello' },
      }),
    ).toEqual({
      projectId: 'p1',
      model: 'anthropic/claude-opus-4',
      effort: 'high',
      fast: false,
      provider: ESandboxProvider.Agent37,
      firstMessage: { text: 'hello' },
    })
  })
})

describe('initialProjectIdOf', () => {
  it('starts on the preselected project when the operator has it', () => {
    expect(initialProjectIdOf({ projects, preselected: 'p2' })).toBe('p2')
  })

  it('starts on the first project when the preselected one is unknown', () => {
    expect(initialProjectIdOf({ projects, preselected: 'gone' })).toBe('p1')
  })

  it('starts on the first project when nothing is preselected', () => {
    expect(initialProjectIdOf({ projects, preselected: undefined })).toBe('p1')
  })

  it('starts without a project when the operator has none', () => {
    expect(initialProjectIdOf({ projects: [], preselected: 'p1' })).toBeNull()
  })
})
