import { describe, expect, it } from 'bun:test'

import {
  REFUSAL_NOT_A_MESSAGE,
  REFUSAL_NOTHING_TO_REWIND,
  rewindArgs,
  rewindTargetOf,
} from '../spec'
import { eventsFrom, replied, said } from './fixture'

const events = eventsFrom([said('first'), replied('one'), said('second'), replied('two')])

describe('rewindTargetOf', () => {
  it('returns the picked message as the draft', () => {
    expect(rewindTargetOf({ events, toSeq: 3 })).toEqual({ allowed: true, draft: 'second' })
    expect(rewindTargetOf({ events, toSeq: 1 })).toEqual({ allowed: true, draft: 'first' })
  })

  it('refuses a sequence that is not a user message', () => {
    expect(rewindTargetOf({ events, toSeq: 2 })).toEqual({
      allowed: false,
      reason: REFUSAL_NOT_A_MESSAGE,
    })
    expect(rewindTargetOf({ events, toSeq: 99 })).toEqual({
      allowed: false,
      reason: REFUSAL_NOT_A_MESSAGE,
    })
  })

  it('refuses the head of the thread', () => {
    const head = eventsFrom([said('first'), replied('one'), said('last')])
    expect(rewindTargetOf({ events: head, toSeq: 3 })).toEqual({
      allowed: false,
      reason: REFUSAL_NOTHING_TO_REWIND,
    })
  })

  it('uses the pinned guard strings', () => {
    expect(REFUSAL_NOT_A_MESSAGE).toBe('Only one of your messages can be rewound to')
    expect(REFUSAL_NOTHING_TO_REWIND).toBe('Nothing to rewind yet')
  })
})

describe('rewindArgs', () => {
  it.each([{ toSeq: 0 }, { toSeq: 1.5 }, { toSeq: '2' }, {}, { toSeq: 2, extra: 1 }])(
    'refuses %p',
    (value) => {
      expect(rewindArgs.safeParse(value).success).toBe(false)
    },
  )

  it('accepts a positive integer', () => {
    expect(rewindArgs.safeParse({ toSeq: 3 }).success).toBe(true)
  })
})
