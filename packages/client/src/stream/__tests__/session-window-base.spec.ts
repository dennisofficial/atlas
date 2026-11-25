import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  foldableOf,
  isDurable,
  toRunId,
  toThreadId,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { windowOfBase } from '../session-base'
import { applyPageOutcome, EMPTY_WINDOW, applyPage, type SessionWindow } from '../session-window'
import { pageOf, replayOf, TAIL_FROM, tailLogOf, TOTAL } from './tail-support'

const setup = () => {
  const { all, full, base, tail } = tailLogOf()
  const started = windowOfBase({ message: base as Extract<StreamServerMessage, { type: 'base' }> })
  if (started === undefined) throw new Error('the base did not validate')
  return { all, full, base, tail, started }
}

const seqsOf = (window: SessionWindow): number[] => window.events.map((event) => event.seq)

describe('the tail base', () => {
  it('folds nothing the base already covers', () => {
    const { tail, full, started } = setup()
    const based = applyPage({ window: started, page: pageOf(tail) })
    expect(based.view).toEqual(full.view)
    expect(based.pending).toEqual(full.pending)
    expect(based.visibility).toEqual(full.visibility)
    expect(based.failureMessage).toEqual(full.failureMessage)
    expect(based.view.at).toBe(TOTAL)
    expect(based.foldedThrough).toBe(TOTAL)
    expect(seqsOf(based)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(seqsOf(full)).toContain(1)
  })

  it('keeps the head state when the tail arrives in several pages', () => {
    const { tail, full, started } = setup()
    const first = applyPage({ window: started, page: pageOf(tail.slice(0, 5)) })
    const second = applyPage({ window: first, page: pageOf(tail.slice(5)) })
    expect(second.view).toEqual(full.view)
    expect(second.pending).toEqual(full.pending)
    expect(second.view.spend.rows).toEqual(full.view.spend.rows)
    const redelivered = applyPage({ window: second, page: pageOf(tail.slice(0, 5)) })
    expect(redelivered.view).toEqual(full.view)
    expect(redelivered.pending.pending).toHaveLength(1)
  })

  it('carries the durable and command log entries of the prefix only', () => {
    const { all, base } = setup()
    const message = base as Extract<StreamServerMessage, { type: 'base' }>
    expect(message.durable.every((event) => Number(event.seq) < TAIL_FROM)).toBe(true)
    expect(message.commandLog.every((event) => Number(event.seq) < TAIL_FROM)).toBe(true)
    expect(message.commandLog.some((event) => event.type === 'history-rewound')).toBe(true)
    expect(message.durable.some((event) => event.type === 'turn-started')).toBe(true)
    expect(all).toHaveLength(TOTAL)
  })

  it('rejects a base built on another view version or a broken window', () => {
    const { base } = setup()
    const message = base as Extract<StreamServerMessage, { type: 'base' }>
    expect(
      windowOfBase({ message: { ...message, view: { ...message.view, version: 1 } } }),
    ).toBeUndefined()
    const broken = { ...message, visibility: 4 } as unknown as typeof message
    expect(windowOfBase({ message: broken })).toBeUndefined()
  })
})

describe('the window foldable list', () => {
  it('keeps a withdraw answer after the render window has dropped it', () => {
    const at = '2026-11-25T10:00:00.000Z'
    const bodies: RecordEventBody[] = [
      {
        type: 'input-posted',
        inboxId: 4,
        kind: 'message',
        postedAt: at,
        message: { text: 'ship it' },
      },
      { type: 'input-withdrawn', inboxId: 4 },
      { type: 'user-said', text: 'next' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'working' }] },
    ]
    const events = chainEvents({
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      epoch: 1,
      at,
      from: undefined,
      bodies,
    })
    const window = applyPageOutcome({
      window: EMPTY_WINDOW,
      page: pageOf(events),
      renderLimit: 1,
    }).window
    expect(window.events.map((event) => event.type)).toEqual(['assistant-said'])
    expect(window.foldable.some((event) => event.type === 'input-withdrawn')).toBe(true)
  })

  it('counts the durable events of the prefix once', () => {
    const { all, tail, started } = setup()
    const based = applyPage({ window: started, page: pageOf(tail) })
    const replay = replayOf(all)
    expect(foldableOf({ visible: based.events, durable: based.durable })).toEqual([
      ...based.foldable,
    ])
    expect(based.durable.map((event: RecordEvent) => event.seq)).toEqual(
      all.filter((event) => isDurable(event.type)).map((event) => event.seq),
    )
    expect(replay.durable.map((event) => event.seq)).toEqual(
      based.durable.map((event) => event.seq),
    )
  })
})
