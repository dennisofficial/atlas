import { describe, expect, it } from 'bun:test'

import type { LostShell } from '@dltech/atlas-harness'

import { hasLostShells, lostShellCount, lostShellsNotice } from '../lost-shells-model'

const shell = (over: Partial<LostShell> = {}): LostShell => ({
  shellId: 'bash_1',
  command: 'bun run build',
  description: undefined,
  ...over,
})

describe('lost shells', () => {
  it('has none when the list is empty', () => {
    expect(hasLostShells([])).toBe(false)
    expect(hasLostShells([shell()])).toBe(true)
  })

  it('counts one and many', () => {
    expect(lostShellCount([shell()])).toBe('1 background shell')
    expect(lostShellCount([shell(), shell({ shellId: 'bash_2' })])).toBe('2 background shells')
  })

  it('names the shells by description when there is one, command otherwise', () => {
    const notice = lostShellsNotice([shell({ description: 'Run full TUI suite' })])
    expect(notice).toContain('1 background shell')
    expect(notice).toContain('Run full TUI suite')
    expect(lostShellsNotice([shell()])).toContain('bun run build')
  })

  it('says they died with the last process rather than that they finished', () => {
    expect(lostShellsNotice([shell()])).toContain('died with the last process')
  })
})
