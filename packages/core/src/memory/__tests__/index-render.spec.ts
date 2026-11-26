import { describe, expect, it } from 'bun:test'

import {
  fairIndexShares,
  MAX_INDEX_LINES,
  renderMemoryIndex,
  type MemoryIndexLine,
} from '../index-render'

const linesOf = (args: { prefix: string; count: number }): MemoryIndexLine[] =>
  Array.from({ length: args.count }, (_, index) => ({
    name: `${args.prefix}-${index}`,
    description: `claim ${index}`,
  }))

describe('renderMemoryIndex', () => {
  it('groups global and project entries under their own headings', () => {
    const text = renderMemoryIndex({
      global: [{ name: 'prefers-bun', description: 'Uses bun everywhere' }],
      project: {
        key: 'org/repo',
        entries: [{ name: 'deploy-flow', description: 'How deploys run' }],
      },
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

    expect(text).toBe(
      ['### Global', '(none yet)', '', '### Project org/repo', '(none yet)'].join('\n'),
    )
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

  it('gives each scope a fair share so global cannot starve project', () => {
    const text = renderMemoryIndex({
      global: linesOf({ prefix: 'g', count: 300 }),
      project: { key: 'o/r', entries: linesOf({ prefix: 'p', count: 200 }) },
    })

    const entries = text.split('\n').filter((line) => line.startsWith('- '))
    expect(entries).toHaveLength(MAX_INDEX_LINES)
    expect(entries.filter((line) => line.startsWith('- p-'))).toHaveLength(125)
    expect(entries.filter((line) => line.startsWith('- g-'))).toHaveLength(125)
    expect(
      text.endsWith(
        '> 250 more memories are not listed. Consolidate: merge overlapping memories and delete dead ones.',
      ),
    ).toBe(true)
  })

  it('lists the group scope between global and project', () => {
    const text = renderMemoryIndex({
      global: [{ name: 'prefers-bun', description: 'Uses bun everywhere' }],
      group: {
        key: 'Comp AI',
        entries: [{ name: 'ship-on-fridays', description: 'Comp AI ships on Fridays' }],
      },
      project: {
        key: 'org/repo',
        entries: [{ name: 'deploy-flow', description: 'How deploys run' }],
      },
    })

    expect(text).toBe(
      [
        '### Global',
        '- prefers-bun — Uses bun everywhere',
        '',
        '### Group Comp AI',
        '- ship-on-fridays — Comp AI ships on Fridays',
        '',
        '### Project org/repo',
        '- deploy-flow — How deploys run',
      ].join('\n'),
    )
  })

  it('keeps every project line when a large global scope fills the rest', () => {
    const text = renderMemoryIndex({
      global: linesOf({ prefix: 'g', count: 300 }),
      project: { key: 'o/r', entries: linesOf({ prefix: 'p', count: 3 }) },
    })

    expect(text).toContain('### Project o/r\n- p-0 — claim 0\n- p-1 — claim 1\n- p-2 — claim 2')
    expect(text).toContain('> 53 more memories are not listed.')
  })
})

describe('fairIndexShares', () => {
  it.each([
    [
      { global: 10, project: 20 },
      { global: 10, group: 0, project: 20 },
    ],
    [
      { global: 300, project: 10 },
      { global: 240, group: 0, project: 10 },
    ],
    [
      { global: 10, project: 300 },
      { global: 10, group: 0, project: 240 },
    ],
    [
      { global: 300, project: 300 },
      { global: 125, group: 0, project: 125 },
    ],
    [
      { global: 120, project: 130 },
      { global: 120, group: 0, project: 130 },
    ],
    [
      { global: 300, group: 300, project: 300 },
      { global: 125, group: 63, project: 62 },
    ],
    [
      { global: 10, group: 300, project: 300 },
      { global: 10, group: 120, project: 120 },
    ],
  ])('splits %o as %o', (counts, shares) => {
    expect(fairIndexShares({ ...counts, cap: 250 })).toEqual(shares)
  })
})
