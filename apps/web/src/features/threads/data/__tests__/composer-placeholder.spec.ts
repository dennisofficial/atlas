import { describe, expect, it } from 'bun:test'

import {
  composerPlaceholderOf,
  STARTING_PLACEHOLDER,
  SUMMARISING_PLACEHOLDER,
} from '../composer-placeholder'

describe('composerPlaceholderOf', () => {
  it('says a send waits while a summary is being written, even as the sandbox starts', () => {
    expect(composerPlaceholderOf({ summarising: true, starting: true, idle: 'Ask' })).toBe(
      SUMMARISING_PLACEHOLDER,
    )
  })

  it('falls back to the starting copy, then to the idle placeholder', () => {
    expect(composerPlaceholderOf({ summarising: false, starting: true, idle: 'Ask' })).toBe(
      STARTING_PLACEHOLDER,
    )
    expect(composerPlaceholderOf({ summarising: false, starting: false, idle: 'Ask' })).toBe('Ask')
  })
})
