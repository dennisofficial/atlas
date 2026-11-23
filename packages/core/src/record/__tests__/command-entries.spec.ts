import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import {
  COMMAND_OUTCOME_EVENT_TYPES,
  runningCommandEntriesOf,
  unfinishedCommandIdsOf,
} from '../command-entries'
import { EInputConsumed, type V2Body, type V2Event } from '../event'
import { ECompactionAnchor } from '../../events/body'
import { commandInputKind } from '../input-events'
import { NOW, runId, threadId } from './support'

const logOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId, runId, epoch: 3, at: NOW, bodies })

const posted = (args: { inboxId: number; name: string }): V2Body => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: commandInputKind(args.name),
  postedAt: NOW,
})

const consumed = (inboxId: number): V2Body => ({
  type: 'input-consumed',
  inboxId,
  consumed: EInputConsumed.Command,
})

const summarised = (inboxId?: number): V2Body => ({
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 1,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  ...(inboxId === undefined ? {} : { inboxId }),
})

describe('COMMAND_OUTCOME_EVENT_TYPES', () => {
  it('names the record events an unfinished command still owes', () => {
    expect([...COMMAND_OUTCOME_EVENT_TYPES].sort()).toEqual([
      'history-rewound',
      'history-summarised',
    ])
  })
})

describe('unfinishedCommandIdsOf', () => {
  it('counts a consumed command that produces an outcome', () => {
    const events = logOf([posted({ inboxId: 1, name: 'summarise' }), consumed(1)])
    expect(unfinishedCommandIdsOf(events)).toEqual([1])
  })

  it('does not count a consumed command that produces no outcome', () => {
    const events = logOf([
      posted({ inboxId: 1, name: 'subscribe' }),
      consumed(1),
      posted({ inboxId: 2, name: 'unsubscribe' }),
      consumed(2),
      posted({ inboxId: 3, name: 'mcp' }),
      consumed(3),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
  })

  it('counts a consumed command whose posted event is not in the log, so recovery reads its kind', () => {
    expect(unfinishedCommandIdsOf(logOf([consumed(1)]))).toEqual([1])
  })

  it('drops a consumed command once its outcome names it', () => {
    const events = logOf([posted({ inboxId: 1, name: 'summarise' }), consumed(1), summarised(1)])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
  })

  it('drops a consumed command once an outcome without an inboxId follows it', () => {
    const events = logOf([posted({ inboxId: 1, name: 'summarise' }), consumed(1), summarised()])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
  })

  it('drops a consumed command once it is refused', () => {
    const events = logOf([
      posted({ inboxId: 1, name: 'rewind' }),
      consumed(1),
      { type: 'input-refused', inboxId: 1, reason: 'no' },
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
  })
})

describe('runningCommandEntriesOf', () => {
  it('reports only the consumed commands that still owe an outcome', () => {
    const events = logOf([
      posted({ inboxId: 1, name: 'subscribe' }),
      posted({ inboxId: 2, name: 'summarise' }),
      consumed(1),
      consumed(2),
    ])
    expect(runningCommandEntriesOf(events)).toEqual([
      { inboxId: 2, name: 'summarise', postedAt: NOW },
    ])
  })

  it('reports nothing once the outcome lands', () => {
    const events = logOf([posted({ inboxId: 1, name: 'summarise' }), consumed(1), summarised(1)])
    expect(runningCommandEntriesOf(events)).toEqual([])
  })
})

describe('a typed command consumed on a message entry', () => {
  const typedPosted = (inboxId: number, text: string): V2Body => ({
    type: 'input-posted',
    inboxId,
    kind: 'message',
    postedAt: NOW,
    message: { text },
  })

  const typedConsumed = (args: {
    inboxId: number
    name: string
    argumentText: string
    text: string
  }): V2Body => ({
    type: 'input-consumed',
    inboxId: args.inboxId,
    consumed: EInputConsumed.Command,
    command: { name: args.name, argumentText: args.argumentText, text: args.text },
  })

  it('names the unfinished command from the consumed command', () => {
    const events = logOf([
      typedPosted(1, '/summarise hi'),
      typedConsumed({ inboxId: 1, name: 'summarise', argumentText: 'hi', text: '/summarise hi' }),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([1])
    expect(runningCommandEntriesOf(events)).toEqual([
      { inboxId: 1, name: 'summarise', postedAt: NOW },
    ])
  })

  it('does not count a typed command that owes no outcome', () => {
    const events = logOf([
      typedPosted(2, '/rename bench'),
      typedConsumed({ inboxId: 2, name: 'rename', argumentText: 'bench', text: '/rename bench' }),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
    expect(runningCommandEntriesOf(events)).toEqual([])
  })
})
