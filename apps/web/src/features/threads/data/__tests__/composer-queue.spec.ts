import { describe, expect, it } from 'bun:test'

import { queuedOf, takeBackableIdOf } from '../composer-queue'

describe('queuedOf', () => {
  it('shows each pending entry as a queued message', () => {
    expect(queuedOf([{ id: 'p1', text: 'next', reserved: false }])).toEqual([
      { id: 'p1', text: 'next', removable: true },
    ])
  })

  it('offers removal only on the entry take-back would remove', () => {
    const queued = queuedOf([
      { id: 'p1', text: 'a', reserved: false },
      { id: 'p2', text: 'b', reserved: false },
    ])

    expect(queued.map((message) => message.removable)).toEqual([false, true])
  })
})

describe('takeBackableIdOf', () => {
  it('picks the newest unreserved operator entry', () => {
    expect(
      takeBackableIdOf([
        { id: 'p1', text: 'a', reserved: false },
        { id: 'p2', text: 'b', reserved: false },
        { id: 'p3', text: 'c', via: 'parent-agent', reserved: false },
        { id: 'p4', text: 'd', reserved: true },
      ]),
    ).toBe('p2')
  })

  it('is null when nothing can be taken back', () => {
    expect(takeBackableIdOf([])).toBeNull()
  })
})
