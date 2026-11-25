import { afterEach, describe, expect, it } from 'bun:test'

import { fakeFetch, mutationUrl, trpcOk } from '@/features/threads/data/__tests__/trpc-fake'

import { archiveThread } from '../archive-thread'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('archiveThread', () => {
  it('sends a session to sessions.archive with the archive flag', async () => {
    const calls = fakeFetch(() => trpcOk({ archivedAt: null }))
    for (const archived of [true, false]) {
      await archiveThread({ threadId: 'v2-a', archived })
    }
    expect(calls).toEqual(
      [true, false].map((archived) => ({
        url: mutationUrl('sessions.archive'),
        method: 'POST',
        body: { sessionId: 'v2-a', archived },
      })),
    )
  })
})
