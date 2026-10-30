import { afterEach, describe, expect, it } from 'bun:test'

import { BOOT_STEP_EVENT_TYPE, EPodState, type WireEvent } from '@dltech/atlas-wire/web'

import { fakeFetch, mutationUrl, trpcFailure, trpcOk } from './trpc-fake'

import {
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
    ).toEqual({ sendId: 's1', text: 'build it', uploads: [] })
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.Failed }),
    ).toEqual({ sendId: 's1', text: 'build it', uploads: [] })
    expect(
      takeBackTargetOf({ events: [said(1, 'build it', 's1')], podState: EPodState.None }),
    ).toEqual({ sendId: 's1', text: 'build it', uploads: [] })
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
    ).toEqual({ sendId: 's2', text: 'two', uploads: [] })
  })

  it('ignores legacy boot events when finding the last core event', () => {
    expect(
      takeBackTargetOf({
        events: [said(1, 'hi', 's1'), legacyBoot(2)],
        podState: EPodState.Booting,
      }),
    ).toEqual({ sendId: 's1', text: 'hi', uploads: [] })
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

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('reports taken back on success and mutates threadMessages.takeBack', async () => {
    const calls = fakeFetch(() => trpcOk(undefined))
    expect(await takeBack({ threadId: 't 1', sendId: 's/1' })).toBe(ETakeBackOutcome.TakenBack)
    expect(calls).toEqual([
      {
        url: mutationUrl('threadMessages.takeBack'),
        method: 'POST',
        body: { threadId: 't 1', sendId: 's/1' },
      },
    ])
  })

  it('reports too late on 409 without throwing', async () => {
    fakeFetch(() => trpcFailure({ status: 409, message: 'nope' }))
    expect(await takeBack({ threadId: 't1', sendId: 's1' })).toBe(ETakeBackOutcome.TooLate)
  })

  it('rethrows any other failure', async () => {
    fakeFetch(() => trpcFailure({ status: 500, message: 'nope' }))
    await expect(takeBack({ threadId: 't1', sendId: 's1' })).rejects.toThrow()
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

describe('takeBackTargetOf uploads', () => {
  it('parses uploads from the event body', () => {
    const uploads = [
      {
        uploadId: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01',
        pathname: 'p',
        name: 'a.pdf',
        size: 1,
        mediaType: 'x/y',
      },
    ]
    const event = wire({
      seq: 1,
      type: 'user-said',
      body: { type: 'user-said', text: 'see', requestId: 's1', uploads },
    })
    expect(takeBackTargetOf({ events: [event], podState: EPodState.Booting })).toEqual({
      sendId: 's1',
      text: 'see',
      uploads,
    })
  })
})
