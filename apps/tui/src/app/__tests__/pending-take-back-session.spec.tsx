import { describe, expect, test } from 'bun:test'
import { useRef } from 'react'

import { withdrawStore } from '@dltech/atlas-client/session'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { mountProbe } from '../../ui/hooks/__tests__/mention-reader-fixture'
import { usePendingTakeBack } from '../use-pending-take-back'
import { useSessionTranscript } from '../use-session-transcript'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const SESSION_A = 'session-a'

const SESSION_B = 'session-b'

const INBOX = 4

const ALREADY_SENT = 'Already sent — the agent got it'

const posted = {
  type: 'input-posted',
  inboxId: INBOX,
  kind: 'message',
  postedAt: '2026-11-25T10:00:00.000Z',
  message: { text: 'ship it' },
} as const

const refused = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: INBOX,
  reason: 'already-sent',
} as const

const probe = { problems: [] as string[] }

const readClock = (): number => 0

function Harness(props: { client: FakeSessionClient; sessionId: string }): React.ReactNode {
  const editor = useRef(null)
  const transcript = useSessionTranscript({
    client: props.client,
    sessionId: props.sessionId,
    title: null,
    now: readClock,
  })
  const takeBack = usePendingTakeBack({
    api: props.client.api,
    sessionId: props.sessionId,
    pending: transcript.pending,
    foldable: transcript.foldable,
    draft: {
      value: '',
      editor,
      setValue: () => undefined,
      clear: () => undefined,
      sync: () => undefined,
      initial: '',
    },
    restore: () => undefined,
    onProblem: (reason) => probe.problems.push(reason),
  })
  return <text>{`${takeBack.hiddenInboxIds.size}`}</text>
}

describe('a direct switch from one session to another', () => {
  test('does not settle the second session from the first session events', async () => {
    probe.problems = []
    const client = fakeSessionClient({ onAuthLost: () => undefined })
    const harness = await mountProbe({
      render: (props: { client: FakeSessionClient; sessionId: string }) => <Harness {...props} />,
      props: { client, sessionId: SESSION_A },
    })

    try {
      await harness.act(() => {
        client.pushEvents({
          sessionId: SESSION_A,
          events: mintEvents({ bodies: [posted, refused] }),
          live: true,
        })
        client.pushEvents({
          sessionId: SESSION_B,
          events: mintEvents({ bodies: [posted] }),
          live: true,
        })
      })

      await harness.act(() => {
        withdrawStore.request({ sessionId: SESSION_B, targetInboxId: INBOX })
      })

      await harness.rerender({ client, sessionId: SESSION_B })

      expect(probe.problems).toEqual([])

      await harness.act(() => {
        withdrawStore.request({ sessionId: SESSION_B, targetInboxId: INBOX })
        client.pushEvents({
          sessionId: SESSION_B,
          events: mintEvents({ bodies: [posted, refused] }),
          live: true,
        })
      })

      expect(probe.problems).toEqual([ALREADY_SENT])
      expect(withdrawStore.intentsOf(SESSION_B)).toEqual([])
    } finally {
      withdrawStore.clear(SESSION_A)
      withdrawStore.clear(SESSION_B)
      await harness.done()
    }
  }, 30_000)
})
