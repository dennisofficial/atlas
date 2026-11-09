import { describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType, type MemorySummary } from '@dltech/atlas-wire'

import { memoryIndexOf, unavailableIndexOf } from '..'

const summary = (overrides: Partial<MemorySummary> = {}): MemorySummary => ({
  scope: EMemoryScope.Global,
  project: null,
  name: 'dennis-prefers-bun',
  description: 'The workspace runs on Bun',
  type: EMemoryType.User,
  revision: 1,
  updatedAt: '2026-11-09T10:00:00.000Z',
  ...overrides,
})

describe('memoryIndexOf', () => {
  it('renders the global entries under a global heading', () => {
    const text = memoryIndexOf({ project: null, memories: [summary()] })
    expect(text).toContain('### Global')
    expect(text).toContain('- dennis-prefers-bun — The workspace runs on Bun')
    expect(text).not.toContain('### Project')
  })

  it('renders project entries under the project they belong to', () => {
    const project = summary({
      scope: EMemoryScope.Project,
      project: 'dennisofficial/atlas',
      name: 'v2-needs-no-v1-imports',
    })
    const text = memoryIndexOf({ project: 'dennisofficial/atlas', memories: [summary(), project] })
    expect(text).toContain('### Project dennisofficial/atlas')
    expect(text).toContain('- v2-needs-no-v1-imports')
    expect(text.indexOf('### Global')).toBeLessThan(text.indexOf('### Project'))
  })

  it('says none yet for a scope with no entries', () => {
    expect(memoryIndexOf({ project: 'o/r', memories: [] })).toContain('(none yet)')
  })
})

describe('unavailableIndexOf', () => {
  it('names the reason without doubling the full stop', () => {
    expect(unavailableIndexOf('the control plane refused the call.')).toBe(
      'Memory is unavailable this session: the control plane refused the call.',
    )
  })
})
