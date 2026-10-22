import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { BOOT_STEP_EVENT_TYPE, EPodState, type WireEvent } from '@dltech/atlas-wire/web'

import {
  awaitingRunOf,
  ETakeBackOutcome,
  restoredDraftOf,
  takeBack,
  takeBackTargetOf,
  withoutTakenBack,
} from '../take-back'

const wire = (args: { seq: number; type: string; body: unknown }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: args.type,
  body: JSON.stringify(args.body),
})

const said = (seq: number, text: string, requestId?: string) =>
  wire({
    seq,
    type: 'user-said',
    body: { type: 'user-said', text, ...(requestId === undefined ? {} : { requestId }) },
  })
const answered = (seq: number) =>
  wire({
    seq,
    type: 'assistant-said',
    body: { type: 'assistant-said', parts: [{ type: 'text', text: 'ok' }] },
  })
const legacyBoot = (seq: number) =>
  wire({ seq, type: BOOT_STEP_EVENT_TYPE, body: { step: 'provision', state: 'running' } })

describe('takeBackTargetOf', () => {
  it('targets the last user message when nothing ran after it and the pod is not running', () => {
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.Booting }),
    ).toEqual({ sendId: 's1', text: 'build it' })
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.Failed }),
    ).toEqual({ sendId: 's1', text: 'build it' })
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.None }),
    ).toEqual({ sendId: 's1', text: 'build it' })
  })

  it('is null while the pod is parked, even when the last event is an unanswered message', () => {
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.Parked }),
    ).toBeNull()
  })

  it('is null once any core event follows the message, whatever the pod state', () => {
    for (const podState of [EPodState.None, EPodState.Booting, EPodState.Failed]) {
      expect(takeBackTargetOf({ events: [said(1, 'hi', 's1'), answered(2)], podState })).toBeNull()
    }
  })

  it('targets a message sent after an earlier answered turn', () => {
    expect(
      takeBackTargetOf({
        events: [said(1, 'one', 's1'), answered(2), said(3, 'two', 's2')],
        podState: EPodState.Booting,
      }),
    ).toEqual({ sendId: 's2', text: 'two' })
  })

  it('ignores legacy boot events when finding the last core event', () => {
    expect(
      takeBackTargetOf({
        events: [said(1, 'hi', 's1'), legacyBoot(2)],
        podState: EPodState.Booting,
      }),
    ).toEqual({ sendId: 's1', text: 'hi' })
  })

  it('is null once the agent answered, the pod runs, or the pod is unknown', () => {
    expect(
      takeBackTargetOf({
        events: [said(1, 'hi', 's1'), answered(2)],
        podState: EPodState.Booting,
      }),
    ).toBeNull()
    expect(
      takeBackTargetOf({ events: [said(1, 'hi', 's1')], podState: EPodState.Running }),
    ).toBeNull()
    expect(takeBackTargetOf({ events: [said(1, 'hi', 's1')], podState: null })).toBeNull()
  })

  it('is null for an empty thread or a message with no send id', () => {
    expect(takeBackTargetOf({ events: [], podState: EPodState.Booting })).toBeNull()
    expect(takeBackTargetOf({ events: [said(1, 'hi')], podState: EPodState.Booting })).toBeNull()
  })
})

describe('restoredDraftOf', () => {
  it('puts the taken-back text in an empty composer', () => {
    expect(restoredDraftOf({ current: '', restored: 'build it' })).toBe('build it')
    expect(restoredDraftOf({ current: '  ', restored: 'build it' })).toBe('build it')
  })

  it('keeps what the user already typed after the restored text', () => {
    expect(restoredDraftOf({ current: 'and test', restored: 'build it' })).toBe(
      'build it\n\nand test',
    )
  })
})

describe('takeBack', () => {
  const realFetch = globalThis.fetch
  let status: number
  let calls: { url: string; method: string | undefined }[]

  beforeEach(() => {
    calls = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method })
      return status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify({ message: 'nope' }), {
            status,
            headers: { 'content-type': 'application/json' },
          })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('reports taken back on 204 and calls DELETE on the message', async () => {
    status = 204
    expect(await takeBack({ threadId: 't 1', sendId: 's/1' })).toBe(ETakeBackOutcome.TakenBack)
    expect(calls).toEqual([{ url: '/v1/threads/t%201/messages/s%2F1', method: 'DELETE' }])
  })

  it('reports too late on 409 without throwing', async () => {
    status = 409
    expect(await takeBack({ threadId: 't1', sendId: 's1' })).toBe(ETakeBackOutcome.TooLate)
  })

  it('rethrows any other failure', async () => {
    status = 500
    await expect(takeBack({ threadId: 't1', sendId: 's1' })).rejects.toThrow()
  })
})

describe('awaitingRunOf', () => {
  it('is true while the last core event is a user message', () => {
    expect(awaitingRunOf([said(1, 'hi', 's1'), legacyBoot(2)])).toBe(true)
    expect(awaitingRunOf([said(1, 'hi', 's1'), answered(2)])).toBe(false)
    expect(awaitingRunOf([])).toBe(false)
  })
})

describe('withoutTakenBack', () => {
  it('hides the user message with the taken-back send id', () => {
    const events = [said(1, 'one', 's1'), said(2, 'two', 's2')]
    expect(
      withoutTakenBack({ events, sendIds: new Set(['s2']) }).map((event) => event.seq),
    ).toEqual([1])
    expect(withoutTakenBack({ events, sendIds: new Set() })).toBe(events)
  })
})
