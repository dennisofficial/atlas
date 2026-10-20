import { describe, expect, it } from 'bun:test'

import { MAX_INDEX_LINES, renderMemoryIndex, type MemoryIndexLine } from '../index-render'

const linesOf = (args: { prefix: string; count: number }): MemoryIndexLine[] =>
  Array.from({ length: args.count }, (_, index) => ({
    name: `${args.prefix}-${index}`,
    description: `claim ${index}`,
  }))

describe('renderMemoryIndex', () => {
  it('groups global and project entries under their own headings', () => {
    const text = renderMemoryIndex({
      global: [{ name: 'prefers-bun', description: 'Uses bun everywhere' }],
      project: { key: 'org/repo', entries: [{ name: 'deploy-flow', description: 'How deploys run' }] },
    })

    expect(text).toBe(
      [
        '### Global',
        '- prefers-bun — Uses bun everywhere',
        '',
        '### Project org/repo',
        '- deploy-flow — How deploys run',
      ].join('\n'),
    )
  })

  it('collapses line breaks in names and descriptions so each entry is one line', () => {
    const text = renderMemoryIndex({
      global: [{ name: 'multi\nline', description: 'first\r\n  second \n\n third  spaced' }],
      project: null,
    })

    expect(text).toBe('### Global\n- multi line — first second third  spaced')
  })

  it('prints (none yet) for an empty scope', () => {
    const text = renderMemoryIndex({ global: [], project: { key: 'org/repo', entries: [] } })

    expect(text).toBe(['### Global', '(none yet)', '', '### Project org/repo', '(none yet)'].join('\n'))
  })

  it('omits the project section when the session has no project', () => {
    const text = renderMemoryIndex({ global: [{ name: 'a', description: 'b' }], project: null })

    expect(text).toBe('### Global\n- a — b')
    expect(text).not.toContain('Project')
  })

  it('lists exactly the cap without an overflow line', () => {
    const text = renderMemoryIndex({
      global: linesOf({ prefix: 'g', count: 120 }),
      project: { key: 'o/r', entries: linesOf({ prefix: 'p', count: MAX_INDEX_LINES - 120 }) },
    })

    expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(MAX_INDEX_LINES)
    expect(text).not.toContain('more memories')
  })

  it('fills the cap with global lines first, then project, and says how many were cut', () => {
    const text = renderMemoryIndex({
      global: linesOf({ prefix: 'g', count: 150 }),
      project: { key: 'o/r', entries: linesOf({ prefix: 'p', count: 80 }) },
    })

    const entries = text.split('\n').filter((line) => line.startsWith('- '))
    expect(entries).toHaveLength(MAX_INDEX_LINES)
    expect(text).toContain('- g-149 — claim 149')
    expect(text).toContain('- p-49 — claim 49')
    expect(text).not.toContain('- p-50 ')
    expect(text.endsWith(
      '> 30 more memories are not listed. Consolidate: merge overlapping memories and delete dead ones.',
    )).toBe(true)
  })

  it('drops all project lines when global alone fills the cap', () => {
    const text = renderMemoryIndex({
      global: linesOf({ prefix: 'g', count: 205 }),
      project: { key: 'o/r', entries: linesOf({ prefix: 'p', count: 3 }) },
    })

    expect(text).toContain('### Project o/r\n(none yet)')
    expect(text).toContain('> 8 more memories are not listed.')
  })
})
