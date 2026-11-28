import { describe, expect, it } from 'bun:test'

import { EMPTY_SKILL_MD, MAX_SKILL_NAME_LENGTH, skillNameIsValid } from '../skill-name'

describe('skillNameIsValid', () => {
  it('accepts lowercase letters, digits and dashes after a letter or digit', () => {
    expect(skillNameIsValid({ name: 'tdd' })).toBe(true)
    expect(skillNameIsValid({ name: 'ios-settings-2' })).toBe(true)
  })

  it('rejects an empty name, a leading dash, uppercase and other characters', () => {
    expect(skillNameIsValid({ name: '' })).toBe(false)
    expect(skillNameIsValid({ name: '-skill' })).toBe(false)
    expect(skillNameIsValid({ name: 'Release' })).toBe(false)
    expect(skillNameIsValid({ name: 'release_notes' })).toBe(false)
    expect(skillNameIsValid({ name: 'release notes' })).toBe(false)
  })

  it('rejects a name past the maximum length', () => {
    expect(skillNameIsValid({ name: 'a'.repeat(MAX_SKILL_NAME_LENGTH) })).toBe(true)
    expect(skillNameIsValid({ name: 'a'.repeat(MAX_SKILL_NAME_LENGTH + 1) })).toBe(false)
  })
})

describe('EMPTY_SKILL_MD', () => {
  it('is frontmatter with empty name and description fields', () => {
    expect(EMPTY_SKILL_MD).toBe('---\nname: \ndescription: \n---\n\n')
  })
})
