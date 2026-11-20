import { describe, expect, it } from 'bun:test'

import { oneLine } from '../one-line'

describe('oneLine', () => {
  it('folds every whitespace run, newlines and tabs included, to one space', () => {
    expect(oneLine('vault\n  audit\t\tnow')).toBe('vault audit now')
  })

  it('trims both ends', () => {
    expect(oneLine('  \n Refresh-token rotation \r\n ')).toBe('Refresh-token rotation')
  })

  it('leaves blank input empty', () => {
    expect(oneLine('')).toBe('')
    expect(oneLine(' \n\t ')).toBe('')
  })

  it('keeps single-line text as it is', () => {
    expect(oneLine('bun run build')).toBe('bun run build')
  })
})
