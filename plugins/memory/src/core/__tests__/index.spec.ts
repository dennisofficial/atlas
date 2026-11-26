import { describe, expect, it } from 'bun:test'

import type { MemorySummary } from '@dltech/atlas-plugin-sdk'

import { memoryIndexOf } from '..'

const summary = (overrides: Partial<MemorySummary> = {}): MemorySummary => ({
  scope: 'global',
  project: null,
  groupId: null,
  name: 'dennis-prefers-bun',
  description: 'The workspace runs on Bun',
  type: 'user',
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
      scope: 'project',
      project: 'dennisofficial/atlas',
      name: 'v2-needs-no-v1-imports',
    })
    const text = memoryIndexOf({ project: 'dennisofficial/atlas', memories: [summary(), project] })
    expect(text).toContain('### Project dennisofficial/atlas')
    expect(text).toContain('- v2-needs-no-v1-imports')
    expect(text.indexOf('### Global')).toBeLessThan(text.indexOf('### Project'))
  })

  it('renders group entries between global and project', () => {
    const group = summary({ scope: 'group', groupId: 'pgr_1', name: 'comp-ai-ships-on-fridays' })
    const text = memoryIndexOf({
      project: 'dennisofficial/atlas',
      group: 'Comp AI',
      memories: [summary(), group],
    })
    expect(text).toContain('### Group Comp AI')
    expect(text.indexOf('### Global')).toBeLessThan(text.indexOf('### Group'))
    expect(text.indexOf('### Group')).toBeLessThan(text.indexOf('### Project'))
  })

  it('says none yet for a scope with no entries', () => {
    expect(memoryIndexOf({ project: 'o/r', memories: [] })).toContain('(none yet)')
  })

  it('renders byte-identical text when the same entries arrive in another order', () => {
    const memories = [
      summary({ name: 'delta-prefers-bun' }),
      summary({ name: 'alpha-runs-tests-first' }),
      summary({ scope: 'project', project: 'o/r', name: 'charlie-uses-biome' }),
      summary({ scope: 'project', project: 'o/r', name: 'bravo-keeps-prs-small' }),
    ]
    const rendered = memoryIndexOf({ project: 'o/r', memories })
    const shuffled = memoryIndexOf({
      project: 'o/r',
      memories: [memories[2]!, memories[0]!, memories[3]!, memories[1]!],
    })
    expect(shuffled).toBe(rendered)
    expect(rendered.length).toBe(
      memoryIndexOf({ project: 'o/r', memories: [...memories].reverse() }).length,
    )
  })

  it('lists each scope in name order, whatever order the list arrives in', () => {
    const memories = [
      summary({ name: 'zeta' }),
      summary({ name: 'alpha' }),
      summary({ name: 'mid' }),
    ]
    const text = memoryIndexOf({ project: null, memories })
    expect(text.indexOf('- alpha')).toBeLessThan(text.indexOf('- mid'))
    expect(text.indexOf('- mid')).toBeLessThan(text.indexOf('- zeta'))
  })
})
