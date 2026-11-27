import { describe, expect, it } from 'bun:test'

import { entryKeyOf, eventIdOfEntryKey } from '../entry-key'

describe('entry keys', () => {
  it('reads the event id back out of a part key', () => {
    expect(eventIdOfEntryKey(entryKeyOf({ eventId: 'evt-1', part: 2 }))).toBe('evt-1')
  })

  it('keeps a key that names its event alone', () => {
    expect(eventIdOfEntryKey('evt-1')).toBe('evt-1')
  })
})
