import { describe, expect, it } from 'bun:test'

import { sanitizedTitle } from '../session-title'

describe('sanitizedTitle', () => {
  it('keeps a name the model already gave in the shape asked for', () => {
    expect(sanitizedTitle('Refresh token rotation')).toBe('Refresh token rotation')
  })

  it('strips the quotes a model wraps its answer in', () => {
    expect(sanitizedTitle('"Refresh token rotation"')).toBe('Refresh token rotation')
    expect(sanitizedTitle('“Refresh token rotation”')).toBe('Refresh token rotation')
  })

  it('strips punctuation the name does not need', () => {
    expect(sanitizedTitle('Refresh token rotation.')).toBe('Refresh token rotation')
    expect(sanitizedTitle('Refresh token rotation?!')).toBe('Refresh token rotation')
  })

  it('puts a name that arrived over several lines onto one', () => {
    expect(sanitizedTitle('Refresh\n  token\trotation')).toBe('Refresh token rotation')
  })

  it('keeps at most four words', () => {
    expect(sanitizedTitle('one two three four five six seven eight nine ten eleven twelve')).toBe(
      'one two three four',
    )
  })

  it('cuts an overlong name at a word boundary rather than mid-word', () => {
    const words = Array.from({ length: 3 }, (_, index) => `word${index}${'x'.repeat(10)}`)
    const title = sanitizedTitle(`${words.join(' ')} overflow`)

    expect(title?.length).toBeLessThanOrEqual(32)
    expect(title?.endsWith(' ')).toBe(false)
    expect(title?.endsWith('overflow')).toBe(false)
  })

  it('reports nothing when the output is a refusal or a preamble', () => {
    expect(sanitizedTitle("I'm sorry, I can't help with that")).toBeNull()
    expect(sanitizedTitle('I cannot name this session')).toBeNull()
    expect(sanitizedTitle('Sure, here is a name')).toBeNull()
    expect(sanitizedTitle("Here's a title: Login Fix")).toBeNull()
    expect(sanitizedTitle('As an AI model I decline')).toBeNull()
  })

  it('keeps a name that merely starts like a refusal word', () => {
    expect(sanitizedTitle('Surely Retry Logic')).toBe('Surely Retry Logic')
    expect(sanitizedTitle('Sorting Algorithm Bug')).toBe('Sorting Algorithm Bug')
  })

  it('reports nothing when the model said nothing worth keeping', () => {
    expect(sanitizedTitle('')).toBeNull()
    expect(sanitizedTitle('   \n  ')).toBeNull()
    expect(sanitizedTitle('"..."')).toBeNull()
  })
})
