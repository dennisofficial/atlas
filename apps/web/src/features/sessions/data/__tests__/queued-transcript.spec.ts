import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EPrEventKind,
  EServiceStatus,
  stampEvent,
  toThreadId,
  type Event,
  type EventBody,
  type PendingInputsState,
} from '@dltech/atlas-core'
import { noticeEntriesOf } from '@dltech/atlas-client/transcript'

import { EOutgoingPlacement } from '@dltech/atlas-client/stream'

import { noticeItemOf } from '@/features/threads/data/transcript-notices'

import {
  EQueuedRowKind,
  optimisticQueuedRowsOf,
  optimisticUserItemsOf,
  queuedRowsOf,
} from '../queued-transcript'

const AT = '2026-11-23T10:00:00.000Z'

const input = (args: {
  inboxId: number
  seq?: number
  kind: string
  event?: EventBody
  text?: string
}): PendingInputsState['pending'][number] => ({
  inboxId: args.inboxId,
  seq: args.seq ?? args.inboxId,
  at: AT,
  kind: args.kind,
  ...(args.event === undefined ? {} : { event: args.event }),
  ...(args.text === undefined
    ? {}
    : { message: { text: args.text, clientId: `client-${args.inboxId}` } }),
})

const prEvent: EventBody = {
  type: 'pr-event',
  repo: 'github.com/owner/atlas',
  prNumber: 2617,
  kind: EPrEventKind.Comment,
  url: 'https://github.com/owner/atlas/pull/2617',
  authorLogin: 'reviewer',
  body: 'This dims the whole notice row, including the link, so the PR number is hard to read.',
}

const agentEnded: EventBody = {
  type: 'agent-ended',
  agentId: toThreadId('agent-a'),
  agentType: 'builder',
  intent: 'dim the queued notice',
  status: EAgentStatus.Finished,
  prose: 'The queued notice now renders through TranscriptNotice.',
  turns: 2,
  toolCalls: 5,
}

const restartingService: EventBody = {
  type: 'service-ended',
  serviceId: 'web',
  command: 'bun run dev',
  status: EServiceStatus.Exited,
  exitCode: 1,
  tail: '',
  restarting: true,
}

const posted = (event: EventBody): Event =>
  stampEvent({
    draft: event,
    envelope: {
      id: 'evt_9',
      seq: 9,
      threadId: toThreadId('thread_1'),
      runId: toThreadId('run_1') as Event['runId'],
      depth: 0,
      at: AT,
    },
  })

const pending: PendingInputsState = {
  pending: [
    input({ inboxId: 3, kind: 'message', text: 'also dim the timestamp' }),
    input({ inboxId: 5, kind: 'event', event: prEvent }),
    input({ inboxId: 7, kind: 'event', event: agentEnded }),
    input({ inboxId: 9, kind: 'event', event: restartingService }),
  ],
}

const rows = queuedRowsOf({ pending, events: [], urls: new Map() })

describe('queuedRowsOf', () => {
  it('walks the pending inputs in seq order and maps each to its row kind', () => {
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ['client-3', EQueuedRowKind.Message],
      ['queued-5', EQueuedRowKind.Notice],
      ['queued-7', EQueuedRowKind.Report],
    ])
  })

  it('keys a pending message row by its clientId and keeps the inbox id for its actions', () => {
    const queued = rows.find((row) => row.id === 'client-3')

    expect(queued?.kind === EQueuedRowKind.Message ? queued.entry.id : undefined).toBe('3')
  })

  it('leaves out a pending message the optimistic row already shows', () => {
    const hidden = queuedRowsOf({
      pending,
      events: [],
      urls: new Map(),
      hiddenInboxIds: new Set([3]),
    })

    expect(hidden.some((row) => row.id === 'client-3')).toBe(false)
    expect(hidden).toHaveLength(rows.length - 1)
  })

  it('skips a notice that a posted transcript would not show', () => {
    expect(rows.some((row) => row.id === 'queued-9')).toBe(false)
  })

  it('titles a queued PR notice exactly as the posted one', () => {
    const [entry] = noticeEntriesOf(posted(prEvent)) ?? []
    const postedTitle = entry === undefined ? undefined : noticeItemOf(entry)?.title
    const queued = rows.find((row) => row.id === 'queued-5')

    expect(queued?.kind === EQueuedRowKind.Notice ? queued.item.title : undefined).toBe(postedTitle)
  })

  it('carries the agent report of an ended sub-agent', () => {
    const queued = rows.find((row) => row.id === 'queued-7')

    expect(queued?.kind === EQueuedRowKind.Report ? queued.item.report : undefined).toBe(
      'The queued notice now renders through TranscriptNotice.',
    )
  })

  it('carries the queued message text and its inbox id', () => {
    const queued = rows.find((row) => row.id === 'client-3')

    expect(queued?.kind === EQueuedRowKind.Message ? queued.entry : undefined).toEqual({
      id: '3',
      text: 'also dim the timestamp',
      attachments: [],
    })
  })
})

describe('optimistic rows', () => {
  const staged = {
    clientId: 'client-a',
    text: 'ship the dimmer',
    attachments: [],
    placement: EOutgoingPlacement.Queue,
    at: AT,
  }

  it('keys an optimistic queued row by its clientId and marks it as having no inbox id', () => {
    const [row] = optimisticQueuedRowsOf({ staged: [staged], urls: new Map() })

    expect(row?.id).toBe('client-a')
    expect(row?.kind === EQueuedRowKind.Message ? row.optimistic : undefined).toBe(true)
    expect(row?.kind === EQueuedRowKind.Message ? row.entry.text : undefined).toBe(
      'ship the dimmer',
    )
  })

  it('builds a landed user item that carries the clientId and the send time', () => {
    const [item] = optimisticUserItemsOf([{ ...staged, placement: EOutgoingPlacement.Transcript }])

    expect(item).toEqual({
      kind: 'user',
      id: 'client-a',
      clientId: 'client-a',
      text: 'ship the dimmer',
      at: AT,
    })
  })
})
