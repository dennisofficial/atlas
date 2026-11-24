import { describe, expect, test } from 'bun:test'
import React from 'react'

import {
  EAttachmentStore,
  EInputConsumed,
  EMPTY_PENDING,
  type Attachment,
  type PendingInputsState,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

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
  restores: { text: string; attachments: readonly Attachment[]; reason: string | undefined }[]
}

const probe: Probe = { staged: null, restores: [] }

function Harness(props: MountProps): React.ReactNode {
  probe.staged = useStagedMessages({
    sessionId: 'session-1',
    events: props.events,
    pending: props.pending ?? EMPTY_PENDING,
    working: props.working,
    onRestore: (args) => probe.restores.push(args),
  })
  return <text>{probe.staged.staged.length}</text>
}

type MountProps = {
  events: readonly V2Event[]
  pending?: PendingInputsState
  working: boolean
}

const unreadOf = (clientId: string): PendingInputsState => ({
  pending: [
    {
      inboxId: 4,
      seq: 1,
      at: '2026-11-20T00:00:00.000Z',
      kind: 'message',
      message: { text: 'hello', clientId },
    },
  ],
})

const mounted = async (): Promise<Mounted<MountProps>> => {
  probe.staged = null
  probe.restores = []
  return await mountProbe<MountProps>({
    render: (props) => <Harness {...props} />,
    props: { events: [], pending: EMPTY_PENDING, working: false },
  })
}

const staged = (): StagedState => {
  if (probe.staged === null) throw new Error('the probe never mounted')
  return probe.staged
}

const SHOT: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

const DISCARDED: V2Body = {
  type: 'input-consumed',
  inboxId: 4,
  consumed: EInputConsumed.Discarded,
}

const message = { clientId: 'c1', text: 'hello', attachments: [] }

describe('useStagedMessages', () => {
  test('keeps the staged copy while its message still waits in the queue', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({
        events: eventsOf([POSTED]),
        pending: unreadOf('c1'),
        working: true,
      })

      expect(staged().staged).toEqual([message])
      expect(probe.restores).toEqual([])

      await harness.rerender({
        events: eventsOf([POSTED, SAID]),
        pending: EMPTY_PENDING,
        working: true,
      })

      expect(staged().staged).toEqual([])
      expect(probe.restores).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a refused event with a reason restores the text', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({
        pending: EMPTY_PENDING,
        events: eventsOf([REFUSED]),
        working: false,
      })

      expect(probe.restores).toEqual([{ text: 'hello', attachments: [], reason: 'unreadable' }])
      expect(staged().staged).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a discarded event puts the text and its attachment back', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage({ ...message, attachments: [SHOT] }))
      await harness.rerender({
        pending: EMPTY_PENDING,
        events: eventsOf([POSTED, DISCARDED]),
        working: false,
      })

      expect(probe.restores).toEqual([{ text: 'hello', attachments: [SHOT], reason: undefined }])
      expect(staged().staged).toEqual([])
      expect(staged().refused).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('an already-sent refusal drops the row without restoring it', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({
        pending: EMPTY_PENDING,
        events: eventsOf([ALREADY]),
        working: false,
      })

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
      await harness.rerender({ pending: EMPTY_PENDING, events: eventsOf([POSTED]), working: false })

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
      await harness.rerender({ pending: EMPTY_PENDING, events: eventsOf([SAID]), working: false })

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
      await harness.rerender({
        pending: EMPTY_PENDING,
        events: eventsOf([REFUSED]),
        working: false,
      })
      await harness.rerender({ pending: EMPTY_PENDING, events: eventsOf([]), working: false })
      await harness.rerender({
        pending: EMPTY_PENDING,
        events: eventsOf([REFUSED]),
        working: false,
      })

      expect(probe.restores).toHaveLength(1)
    } finally {
      await harness.done()
    }
  })

  test('a working turn places a pending row in the queue', async () => {
    const harness = await mounted()
    try {
      await harness.act(() => staged().stage(message))
      await harness.rerender({ pending: EMPTY_PENDING, events: [], working: true })

      expect(staged().queue).toHaveLength(1)
      expect(staged().transcript).toHaveLength(0)
    } finally {
      await harness.done()
    }
  })
})
