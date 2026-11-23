import { describe, expect, test } from 'bun:test'
import React from 'react'

import type { V2Body, V2Event } from '@dltech/atlas-core'

import { mountProbe, type Mounted } from '../../ui/hooks/__tests__/mention-reader-fixture'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'
import { useStagedMessages, type StagedState } from '../staged-messages'

const eventsOf = (bodies: readonly V2Body[]): V2Event[] => mintEvents({ bodies })

const REFUSED: V2Body = { type: 'input-refused', inboxId: 4, reason: 'unreadable', clientId: 'c1' }
const ALREADY: V2Body = {
  type: 'input-refused',
  inboxId: 4,
  reason: 'already-sent',
  clientId: 'c1',
}
const POSTED: V2Body = {
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-20T00:00:00.000Z',
  message: { text: 'hello', clientId: 'c1' },
}
const SAID: V2Body = { type: 'user-said', text: 'hello', clientId: 'c1', inboxId: 4 }

type Probe = {
  staged: StagedState | null
  restores: { text: string; reason: string | undefined }[]
}

const probe: Probe = { staged: null, restores: [] }

function Harness(props: { events: readonly V2Event[]; working: boolean }): React.ReactNode {
  probe.staged = useStagedMessages({
    sessionId: 'session-1',
    events: props.events,
    working: props.working,
    onRestore: (args) => probe.restores.push(args),
  })
  return <text>{probe.staged.staged.length}</text>
}

type Props = { events: readonly V2Event[]; working: boolean }

const mounted = async (): Promise<Mounted<Props>> => {
  probe.staged = null
  probe.restores = []
  return await mountProbe<Props>({
    render: (props) => <Harness {...props} />,
    props: { events: [], working: false },
  })
}

const staged = (): StagedState => {
  if (probe.staged === null) throw new Error('the probe never mounted')
  return probe.staged
}

const message = { clientId: 'c1', text: 'hello', attachments: [] }

describe('useStagedMessages', () => {
  test('a refused event with a reason restores the text', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: eventsOf([REFUSED]), working: false })

      expect(probe.restores).toEqual([{ text: 'hello', reason: 'unreadable' }])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('an already-sent refusal drops the row without restoring it', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: eventsOf([ALREADY]), working: false })

      expect(probe.restores).toEqual([])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a posted event drops the row silently', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: eventsOf([POSTED]), working: false })

      expect(probe.restores).toEqual([])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a user-said event drops the row silently', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: eventsOf([SAID]), working: false })

      expect(probe.restores).toEqual([])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a withdrawn event on the posted inbox drops the row silently', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({
        events: eventsOf([POSTED, { type: 'input-withdrawn', inboxId: 4 }]),
        working: false,
      })

      expect(probe.restores).toEqual([])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a row stays pending until an event names its clientId', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({
        events: eventsOf([{ type: 'user-said', text: 'other' }]),
        working: true,
      })

      expect(staged().staged).toHaveLength(1)
      expect(staged().queue).toHaveLength(1)
    } finally {
      await harness.done()
    }
  })

  test('the same clientId is restored only once', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: eventsOf([REFUSED]), working: false })
      await harness.rerender({ events: eventsOf([]), working: false })
      await harness.rerender({ events: eventsOf([REFUSED]), working: false })

      expect(probe.restores).toHaveLength(1)
    } finally {
      await harness.done()
    }
  })

  test('a working turn places a pending row in the queue', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ events: [], working: true })

      expect(staged().queue).toHaveLength(1)
      expect(staged().transcript).toHaveLength(0)
    } finally {
      await harness.done()
    }
  })
})
