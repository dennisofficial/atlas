import { describe, expect, it } from 'bun:test'

import { processCommandOf, processNameOf } from '../processes-model'

describe('processNameOf', () => {
  it('uses the trimmed description when there is one', () => {
    expect(processNameOf({ command: 'bun dev', description: ' Dev server ' })).toBe('Dev server')
  })

  it('falls back to the command folded onto one line', () => {
    expect(processNameOf({ command: '  bun test \\\n\t--watch ', description: ' ' })).toBe(
      'bun test \\ --watch',
    )
  })
})

describe('processCommandOf', () => {
  it('shows the folded command under a named process', () => {
    expect(processCommandOf({ command: 'bun\n  dev ', description: 'Dev server' })).toBe('bun dev')
  })

  it('shows nothing when the command is already the name', () => {
    expect(processCommandOf({ command: 'bun dev', description: '' })).toBeUndefined()
  })
})
