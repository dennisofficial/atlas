import { describe, expect, it } from 'bun:test'

import { parseChangesLayout } from '../use-changes-layout'

describe('parseChangesLayout', () => {
  it('defaults to flat for missing or unknown values', () => {
    expect(parseChangesLayout(null)).toBe('flat')
    expect(parseChangesLayout('nope')).toBe('flat')
  })

  it('reads a stored tree choice', () => {
    expect(parseChangesLayout('tree')).toBe('tree')
  })
})
