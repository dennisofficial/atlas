import { describe, expect, it } from 'bun:test'
import { ACCESS_GRANT_INSTRUCTION_MAX, ACCESS_GRANT_NAME_MAX } from '@dltech/atlas-wire/web'

import {
  accessGrantDraftValid,
  accessGrantNameValid,
  secretDraftValid,
  secretNameInvalid,
} from '../drafts'

describe('access drafts', () => {
  it('preserves the web grant name predicate', () => {
    for (const name of ['', '  ', '\n']) expect(accessGrantNameValid(name)).toBe(false)
    for (const name of ['Name', ' Name ', 'x'.repeat(ACCESS_GRANT_NAME_MAX + 1)]) {
      expect(accessGrantNameValid(name)).toBe(true)
    }
  })

  it('applies mobile grant limits to the trimmed name and raw instruction', () => {
    expect(accessGrantDraftValid({ name: '  ', instruction: '' })).toBe(false)
    expect(
      accessGrantDraftValid({
        name: ` ${'x'.repeat(ACCESS_GRANT_NAME_MAX)} `,
        instruction: 'x'.repeat(ACCESS_GRANT_INSTRUCTION_MAX),
      }),
    ).toBe(true)
    expect(
      accessGrantDraftValid({ name: 'x'.repeat(ACCESS_GRANT_NAME_MAX + 1), instruction: '' }),
    ).toBe(false)
    expect(
      accessGrantDraftValid({
        name: 'Name',
        instruction: 'x'.repeat(ACCESS_GRANT_INSTRUCTION_MAX + 1),
      }),
    ).toBe(false)
  })

  it('does not show a name error until the user enters a name', () => {
    expect(secretNameInvalid('')).toBe(false)
    for (const name of ['API_KEY', '_TOKEN', 'A2']) expect(secretNameInvalid(name)).toBe(false)
    for (const name of ['lowercase', '2KEY', 'A-B', ' A'])
      expect(secretNameInvalid(name)).toBe(true)
  })

  it('requires a valid secret name and nonempty value, without trimming values', () => {
    expect(secretDraftValid({ name: '', value: 'x' })).toBe(false)
    expect(secretDraftValid({ name: 'bad-name', value: 'x' })).toBe(false)
    expect(secretDraftValid({ name: 'KEY', value: '' })).toBe(false)
    expect(secretDraftValid({ name: 'KEY', value: ' ' })).toBe(true)
    expect(secretDraftValid({ name: 'KEY', value: 'value\n' })).toBe(true)
  })
})
