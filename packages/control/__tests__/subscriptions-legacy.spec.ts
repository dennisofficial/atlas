import { describe, expect, it } from 'bun:test'

import { MAIN, NOW, REPO, SESSION, TTL_LATER, setup } from './subscription-fixtures'

describe('listing rows written before the row columns existed', () => {
  it('derives the provider, label and pull request target', async () => {
    const { store, plane } = await setup()
    const legacy = await store.transact((tx) =>
      tx.insertSubscriptionRow({
        userId: 'user-a',
        repoFullName: 'acme/atlas',
        branch: '#7',
        threadId: MAIN,
        sessionId: '',
        kind: 'pull-request',
        prNumber: 7,
        provider: '',
        target: null,
        label: '',
        createdBy: '',
        events: [],
        expiresAt: TTL_LATER,
        deadline: null,
        createdAt: NOW,
      }),
    )

    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([
      {
        id: legacy.row.subscriptionId,
        threadId: MAIN,
        provider: 'github.pull-request',
        target: { repo: REPO, number: 7 },
        label: 'acme/atlas#7',
        events: [],
        createdBy: '',
        createdAt: NOW,
        expiresAt: TTL_LATER,
      },
    ])
  })
})
