import { toRunId, toThreadId, type V2Event } from '@dltech/atlas-core'
import {
  EOperatorRequestKind,
  OPERATOR_INPUT_ASKED,
  type OperatorInputAsked,
} from '@dltech/atlas-plugin-operator/core'
import { describe, expect, it } from 'bun:test'

import { operatorInputOf } from '../operator-input'
import type { OperatorAnswer, OperatorRequestPort } from '../operator-requests'
import type { SessionRecord } from '../record/record-adapter'

const SESSION = 'ses_1'
const THREAD = toThreadId('thr_1')
const REQUEST = 'oreq_1'

const rigOf = (options?: { openThrows?: string | undefined }) => {
  const events: OperatorInputAsked[] = []
  let taken: OperatorAnswer | undefined
  let resolved: unknown

  const requests: OperatorRequestPort = {
    open: async () => {
      if (options?.openThrows !== undefined) throw new Error(options.openThrows)
      return { requestId: REQUEST }
    },
    settle: async () => true,
    answers: {
      take: () => taken,
      resolve: (params) => {
        resolved = params
      },
    },
  }
  const record = {
    append: async ({ drafts }: { drafts: readonly OperatorInputAsked[] }) => {
      events.push(...drafts)
      return []
    },
    eventCache: () => ({ eventsAfter: () => events as unknown as V2Event[] }),
  } as unknown as SessionRecord

  return {
    input: operatorInputOf({
      requests,
      sessionId: SESSION,
      threadId: THREAD,
      record,
      newRunId: () => toRunId('run_1'),
    }),
    events,
    hand: (value: OperatorAnswer) => {
      taken = value
    },
    resolved: () => resolved,
  }
}

const signal = new AbortController().signal

describe('the operator input adapter', () => {
  it('opens the request, records the question and parks without a deadline', async () => {
    const rig = rigOf()

    const opened = await rig.input.ask({
      ask: { kind: 'input', prompt: 'the login code' },
      signal,
    })

    expect(opened).toEqual({ ok: true, requestId: REQUEST })
    expect(rig.events).toHaveLength(1)
    expect(rig.events[0]).toMatchObject({
      type: OPERATOR_INPUT_ASKED,
      requestId: REQUEST,
      kind: EOperatorRequestKind.Input,
      prompt: 'the login code',
      sessionId: SESSION,
    })
    expect(rig.events[0]).not.toHaveProperty('expiresAt')
    expect(rig.events[0]).not.toHaveProperty('secret')
  })

  it('carries the shell id a shell ask names', async () => {
    const rig = rigOf()

    await rig.input.ask({
      ask: { kind: 'shell', prompt: 'the login code', shellId: 'shl_1' },
      signal,
    })

    expect(rig.events[0]).toMatchObject({ shellId: 'shl_1' })
  })

  it('refuses when the request could not be opened and records nothing', async () => {
    const rig = rigOf({ openThrows: 'this session is already waiting on an operator request' })

    expect(await rig.input.ask({ ask: { kind: 'input', prompt: 'x' }, signal })).toEqual({
      ok: false,
      reason: 'this session is already waiting on an operator request',
    })
    expect(rig.events).toEqual([])
  })

  it('never holds the answer in the record', async () => {
    const rig = rigOf()
    rig.hand({ ok: true, value: 'marked-value-6f2a' })

    await rig.input.ask({ ask: { kind: 'input', prompt: 'x' }, signal })

    expect(JSON.stringify(rig.events)).not.toContain('marked-value-6f2a')
  })

  it('exposes the handoff without touching it while asking', async () => {
    const rig = rigOf()
    await rig.input.ask({ ask: { kind: 'input', prompt: 'x' }, signal })
    expect(rig.resolved()).toBeUndefined()
  })
})
