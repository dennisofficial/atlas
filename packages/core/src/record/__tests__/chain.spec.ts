import { describe, expect, it } from 'bun:test'

import { chainHash } from '../chain'
import { mint } from './support'

describe('chainHash', () => {
  it('hashes the canonical JSON of the event', () => {
    const [event] = mint({ count: 1 })
    expect(String(chainHash(event!))).toBe(
      'c255b9f9b0fa4556dbedfd65b8f4182a8bdacf9a1118fb48b3faa13c2e3f576c',
    )
  })
})
