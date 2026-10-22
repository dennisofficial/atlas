import { describe, expect, it } from 'bun:test'

import { MAX_PROJECT_NAME_LENGTH } from '@dltech/atlas-wire'

import {
  createAnswer,
  EProjectAnswer,
  EProjectPrompt,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  openProjectPrompt,
  problemOf,
  type CreateState,
} from '../project-prompt-model'

const created = (name: string): CreateState => {
  const state = openProjectPrompt({ mode: EProjectPrompt.Create, repo: 'acme/widgets', name, baseBranch: '' })
  if (state.mode !== EProjectPrompt.Create) throw new Error('expected a create prompt')
  return state
}

describe('project prompt create validation', () => {
  it('accepts a name of exactly the maximum length', () => {
    expect(problemOf(created('a'.repeat(MAX_PROJECT_NAME_LENGTH)))).toBeNull()
  })

  it('rejects a name one character past the maximum', () => {
    expect(problemOf(created('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1)))).toBe(NAME_TOO_LONG)
  })

  it('measures the trimmed name', () => {
    const padded = `  ${'a'.repeat(MAX_PROJECT_NAME_LENGTH)}  `

    expect(problemOf(created(padded))).toBeNull()
    expect(createAnswer(created(padded))).toEqual({
      kind: EProjectAnswer.Create,
      name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH),
      baseBranch: null,
    })
  })

  it('still requires a name', () => {
    expect(problemOf(created('   '))).toBe(NAME_REQUIRED)
  })
})
