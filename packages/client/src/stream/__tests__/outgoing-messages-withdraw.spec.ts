import { describe, expect, it } from 'bun:test'

import { stagedWithdrawOwnedIdsOf } from '../outgoing-messages'
import { eventsOf } from './outgoing-messages-fixture'

describe('stagedWithdrawOwnedIdsOf', () => {
  const posted = [
    {
      type: 'input-posted',
      inboxId: 4,
      kind: 'message',
      postedAt: 'now',
      message: { text: 'first', clientId: 'client-a' },
    },
    {
      type: 'input-posted',
      inboxId: 5,
      kind: 'message',
      postedAt: 'now',
      message: { text: 'second', clientId: 'client-b' },
    },
  ]

  it('names the staged messages whose inbox the withdraw path owns', () => {
    const owned = stagedWithdrawOwnedIdsOf({
      events: eventsOf(posted),
      clientIds: ['client-a', 'client-b'],
      ownedInboxIds: new Set([4]),
    })
    expect([...owned]).toEqual(['client-a'])
  })

  it('names nothing while no inbox is owned', () => {
    const owned = stagedWithdrawOwnedIdsOf({
      events: eventsOf(posted),
      clientIds: ['client-a', 'client-b'],
      ownedInboxIds: new Set(),
    })
    expect(owned.size).toBe(0)
  })
})
