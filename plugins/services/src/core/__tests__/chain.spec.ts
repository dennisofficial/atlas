import { describe, expect, it } from 'bun:test'

import { currentServiceIdOf } from '../chain'

describe('currentServiceIdOf', () => {
  it('keeps the id of a service nothing replaced', () => {
    expect(currentServiceIdOf({ rows: [{ serviceId: 'a' }], serviceId: 'a' })).toBe('a')
  })

  it('returns an id the log has never seen', () => {
    expect(currentServiceIdOf({ rows: [{ serviceId: 'a' }], serviceId: 'ghost' })).toBe('ghost')
  })

  it('follows one replacement', () => {
    const rows = [{ serviceId: 'a' }, { serviceId: 'b', replaces: 'a' }]
    expect(currentServiceIdOf({ rows, serviceId: 'a' })).toBe('b')
  })

  it('follows the newest replacement when the log holds several', () => {
    const rows = [
      { serviceId: 'a' },
      { serviceId: 'b', replaces: 'a' },
      { serviceId: 'c', replaces: 'a' },
    ]
    expect(currentServiceIdOf({ rows, serviceId: 'a' })).toBe('c')
  })

  it('follows a chain of replacements to its newest descendant', () => {
    const rows = [
      { serviceId: 'a' },
      { serviceId: 'b', replaces: 'a' },
      { serviceId: 'c', replaces: 'b' },
      { serviceId: 'd', replaces: 'c' },
    ]
    expect(currentServiceIdOf({ rows, serviceId: 'a' })).toBe('d')
    expect(currentServiceIdOf({ rows, serviceId: 'b' })).toBe('d')
  })
})
