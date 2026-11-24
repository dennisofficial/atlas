import { describe, expect, test } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { fakeSessionClient } from './fake-session-client'
import { sessionRowFixture } from './view-fixture'

const sibling = sessionRowFixture({
  sessionId: 'session-two',
  mainThreadId: 'thread-2',
  title: 'the other session',
})

const running = sessionRowFixture({
  sessionId: 'session-two',
  mainThreadId: 'thread-2',
  title: 'the other session',
  status: { state: ESessionStatus.Thinking },
})

describe('the fake session client', () => {
  test('a list subscription starts from the last snapshot pushed, as a live stream does', () => {
    const client = fakeSessionClient({ onAuthLost: () => undefined })

    try {
      client.pushRows([running])
      const list = client.connection.followSessions()

      expect(list.getSnapshot()).toEqual([running])
      list.close()
    } finally {
      client.close()
    }
  })

  test('a list subscription opened between two pushes still holds the one it missed', () => {
    const client = fakeSessionClient({ onAuthLost: () => undefined })

    try {
      client.pushRows([sibling])
      const first = client.connection.followSessions()
      first.close()

      client.pushRows([running])
      const second = client.connection.followSessions()

      expect(second.getSnapshot()?.map((row) => row.status?.state)).toEqual([
        ESessionStatus.Thinking,
      ])
      second.close()
    } finally {
      client.close()
    }
  })
})
