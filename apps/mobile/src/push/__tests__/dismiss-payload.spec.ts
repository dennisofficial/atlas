import { describe, expect, it } from 'bun:test'
import { dismissThreadIdOf } from '../dismiss-payload'

describe('dismissThreadIdOf', () => {
  it('reads the thread a headless push names', () => {
    const data = { dataString: JSON.stringify({ dismissThreadId: 'thr-1' }) }

    expect(dismissThreadIdOf(data)).toBe('thr-1')
  })

  it('reads the thread from a plain data object', () => {
    expect(dismissThreadIdOf({ dismissThreadId: 'thr-2' })).toBe('thr-2')
  })

  it('ignores a payload that dismisses nothing', () => {
    expect(dismissThreadIdOf({ dataString: JSON.stringify({ threadId: 'thr-1' }) })).toBeUndefined()
    expect(dismissThreadIdOf({ dataString: 'not json' })).toBeUndefined()
    expect(dismissThreadIdOf(undefined)).toBeUndefined()
    expect(dismissThreadIdOf({ dismissThreadId: '' })).toBeUndefined()
  })
})
