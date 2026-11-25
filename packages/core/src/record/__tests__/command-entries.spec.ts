import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import {
  COMMAND_OUTCOME_EVENT_TYPES,
  runningCommandEntriesOf,
  unfinishedCommandIdsOf,
} from '../command-entries'
import { EInputConsumed, ERewindCause, type RecordEventBody, type RecordEvent } from '../event'
import { ECompactionAnchor } from '../../events/body'
import { commandInputKind } from '../input-events'
import { NOW, runId, threadId } from './support'

const logOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 3, at: NOW, bodies })

const posted = (args: { inboxId: number; name: string }): RecordEventBody => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: commandInputKind(args.name),
  postedAt: NOW,
})

const consumed = (inboxId: number): RecordEventBody => ({
  type: 'input-consumed',
  inboxId,
  consumed: EInputConsumed.Command,
})

const summarised = (inboxId?: number): RecordEventBody => ({
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
      'command-applied',
      'history-rewound',
      'history-summarised',
      'resume-marked',
      'rotated',
    ])
  })
})

describe('unfinishedCommandIdsOf', () => {
  it('counts a consumed command that produces an outcome', () => {
    const events = logOf([posted({ inboxId: 1, name: 'summarise' }), consumed(1)])
    expect(unfinishedCommandIdsOf(events)).toEqual([1])
  })

  it('finishes a consumed rotate once the boundary lands without an inboxId', () => {
    const unfinished = logOf([posted({ inboxId: 1, name: 'rotate' }), consumed(1)])
    expect(unfinishedCommandIdsOf(unfinished)).toEqual([1])

    const finished = logOf([
      posted({ inboxId: 1, name: 'rotate' }),
      consumed(1),
      { type: 'rotated', handoff: 'the brief' },
    ])
    expect(unfinishedCommandIdsOf(finished)).toEqual([])
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
  const typedPosted = (inboxId: number, text: string): RecordEventBody => ({
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
  }): RecordEventBody => ({
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

describe('a pane command that records one applied outcome', () => {
  const applied = (args: { inboxId: number; name: string }): RecordEventBody => ({
    type: 'command-applied',
    inboxId: args.inboxId,
    name: args.name,
  })

  it('counts a consumed /agent say until its applied outcome lands', () => {
    const events = logOf([posted({ inboxId: 3, name: 'agent' }), consumed(3)])
    expect(unfinishedCommandIdsOf(events)).toEqual([3])
    expect(runningCommandEntriesOf(events)).toEqual([{ inboxId: 3, name: 'agent', postedAt: NOW }])
  })

  it('finishes it once the applied outcome names its inbox', () => {
    const events = logOf([
      posted({ inboxId: 3, name: 'agent' }),
      consumed(3),
      applied({ inboxId: 3, name: 'agent' }),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([])
  })

  it('does not finish it with the applied outcome of another inbox', () => {
    const events = logOf([
      posted({ inboxId: 3, name: 'agent' }),
      consumed(3),
      applied({ inboxId: 4, name: 'agent' }),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([3])
  })

  it('counts a consumed /shell-kill and /service the same way', () => {
    const events = logOf([
      posted({ inboxId: 5, name: 'shell-kill' }),
      consumed(5),
      posted({ inboxId: 6, name: 'service' }),
      consumed(6),
      applied({ inboxId: 5, name: 'shell-kill' }),
    ])
    expect(unfinishedCommandIdsOf(events)).toEqual([6])
  })
})

describe('a quick-stop rewind', () => {
  it('leaves an unrelated pending command pending', () => {
    const events = logOf([
      posted({ inboxId: 2, name: 'summarise' }),
      consumed(2),
      { type: 'history-rewound', toSeq: 0, draft: 'think it over', cause: ERewindCause.QuickStop },
    ])

    expect(unfinishedCommandIdsOf(events)).toEqual([2])
    expect(runningCommandEntriesOf(events)).toEqual([
      { inboxId: 2, name: 'summarise', postedAt: NOW },
    ])
  })

  it('finishes a /rewind command only with the rewind that names its inbox', () => {
    const pending = logOf([
      posted({ inboxId: 1, name: 'rewind' }),
      consumed(1),
      { type: 'history-rewound', toSeq: 0, draft: 'think it over', cause: ERewindCause.QuickStop },
    ])
    expect(unfinishedCommandIdsOf(pending)).toEqual([1])

    const finished = logOf([
      posted({ inboxId: 1, name: 'rewind' }),
      consumed(1),
      { type: 'history-rewound', toSeq: 0, draft: 'think it over', inboxId: 1 },
    ])
    expect(unfinishedCommandIdsOf(finished)).toEqual([])
  })
})
