import { describe, expect, test } from 'bun:test'
import React from 'react'

import { type PendingInputsState, type V2Body, type V2Event } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import {
  deferred,
  mountProbe,
  type Deferred,
  type Mounted,
} from '../../ui/hooks/__tests__/mention-reader-fixture'
import type { DraftControls } from '../../ui/hooks/use-draft'
import type { SessionApi } from '../session-api'
import type { StagedState } from '../staged-messages'
import { usePendingTakeBack, type TakeBack } from '../use-pending-take-back'

const INBOX = 3

const POSTED: V2Body = {
  type: 'input-posted',
  inboxId: INBOX,
  kind: 'message',
  postedAt: '2026-11-20T00:00:00.000Z',
  message: { text: 'hello' },
}

const WITHDRAWN: V2Body = { type: 'input-withdrawn', inboxId: INBOX }

const REFUSED: V2Body = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: INBOX,
  reason: 'already-sent',
}

const eventsOf = (bodies: readonly V2Body[]): V2Event[] => mintEvents({ bodies })

const pendingOf = (): PendingInputsState => ({
  pending: [
    {
      inboxId: INBOX,
      seq: 1,
      at: '2026-11-20T00:00:00.000Z',
      kind: 'message',
      message: { text: 'hello', attachments: [] },
    },
  ],
})

const draftOf = (): DraftControls => ({
  value: '',
  editor: { current: null },
  setValue: () => undefined,
  clear: () => undefined,
  sync: () => undefined,
  initial: '',
})

const stagedOf = (): StagedState => ({
  staged: [],
  queue: [],
  transcript: [],
  refused: [],
  stage: () => undefined,
  settle: () => undefined,
  withdraw: () => null,
})

type Reply = Awaited<ReturnType<SessionApi['withdraw']>>

type Probe = {
  takeBack: TakeBack | null
  restores: string[]
  problems: string[]
}

type MountedProbe = {
  harness: Mounted<{ events: readonly V2Event[] }>
  probe: Probe
  asked: number[]
  answer: Deferred<Reply>
  pressUp: () => Promise<void>
  settle: (reply: Reply) => Promise<void>
}

const mount = async (): Promise<MountedProbe> => {
  const probe: Probe = { takeBack: null, restores: [], problems: [] }
  const asked: number[] = []
  const answer = deferred<Reply>()
  const api = {
    withdraw: async (input: { inboxId: number }) => {
      asked.push(input.inboxId)
      return await answer.promise
    },
  } as unknown as SessionApi

  function Harness(props: { events: readonly V2Event[] }): React.ReactNode {
    probe.takeBack = usePendingTakeBack({
      api,
      sessionId: 'session-1',
      pending: pendingOf(),
      staged: stagedOf(),
      events: props.events,
      draft: draftOf(),
      tokens: { restore: (restored) => probe.restores.push(restored.text) },
      onProblem: (reason) => probe.problems.push(reason),
    })
    return <text>{probe.takeBack.canTakeBack ? 'yes' : 'no'}</text>
  }

  const harness = await mountProbe<{ events: readonly V2Event[] }>({
    render: (props) => <Harness {...props} />,
    props: { events: [] },
  })

  const takeBack = (): TakeBack => {
    if (probe.takeBack === null) throw new Error('the probe never mounted')
    return probe.takeBack
  }

  return {
    harness,
    probe,
    asked,
    answer,
    pressUp: () =>
      harness.act(async () => {
        expect(takeBack().handleTakeBack()).toBe(true)
        await Promise.resolve()
      }),
    settle: (reply) =>
      harness.act(async () => {
        answer.resolve(reply)
        await answer.promise
      }),
  }
}

describe('usePendingTakeBack', () => {
  test('restores nothing until the server confirms the withdraw', async () => {
    const { harness, probe, asked, pressUp } = await mount()
    try {
      await pressUp()

      expect(asked).toEqual([INBOX])
      expect(probe.restores).toEqual([])
      expect(probe.problems).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('restores the queued text once after the confirmation', async () => {
    const { harness, probe, pressUp, settle } = await mount()
    try {
      await pressUp()
      await settle({ ok: true })
      await harness.rerender({ events: eventsOf([POSTED, WITHDRAWN]) })

      expect(probe.restores).toEqual(['hello'])

      await harness.rerender({ events: eventsOf([POSTED, WITHDRAWN]) })
      expect(probe.restores).toEqual(['hello'])
    } finally {
      await harness.done()
    }
  })

  test('a refused event says so and restores nothing', async () => {
    const { harness, probe, pressUp, settle } = await mount()
    try {
      await pressUp()
      await settle({ ok: true })
      await harness.rerender({ events: eventsOf([POSTED, REFUSED]) })

      expect(probe.problems).toEqual(['Already sent'])
      expect(probe.restores).toEqual([])
    } finally {
      await harness.done()
    }
  })

  test('a refused withdraw call says so and restores nothing', async () => {
    const { harness, probe, pressUp, settle } = await mount()
    try {
      await pressUp()
      await settle({ ok: false, reason: 'already-consumed' })
      await harness.rerender({ events: eventsOf([POSTED]) })

      expect(probe.problems).toEqual(['Already sent'])
      expect(probe.restores).toEqual([])
    } finally {
      await harness.done()
    }
  })
})
