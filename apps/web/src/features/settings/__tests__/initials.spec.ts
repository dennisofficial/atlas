import { describe, expect, it } from 'vitest'

import { initialsOf } from '../session/initials'

describe('initialsOf', () => {
  it('uses first and last word', () => {
    expect(initialsOf('Dennis Lysenko')).toBe('DL')
    expect(initialsOf('ada king lovelace')).toBe('AL')
  })

  it('handles single words, emails and empty input', () => {
    expect(initialsOf('dennis')).toBe('D')
    expect(initialsOf('dennis@dltech.dev')).toBe('DD')
    expect(initialsOf('  ')).toBe('?')
  })
})
