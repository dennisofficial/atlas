import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EAttachmentStore,
  EMessageOrigin,
  EPrEventKind,
  EServiceStatus,
  stampEvent,
  toThreadId,
  type Attachment,
  type Event,
  type EventBody,
  type PendingInputsState,
} from '@dltech/atlas-core'
import { noticeEntriesOf } from '@dltech/atlas-client/transcript'

import { EOutgoingPlacement } from '@dltech/atlas-client/stream'

import { ESegmentKind, ETurnKind, type Turn } from '@/features/threads/data/transcript-turns'
import { noticeItemOf } from '@/features/threads/data/transcript-notices'

import { optimisticUserItemsOf, queuedRowsOf } from '../queued-transcript'

const AT = '2026-11-23T10:00:00.000Z'

type MessageSeed = {
  text: string
  clientId?: string
  via?: EMessageOrigin
  sender?: { session: string }
}

const input = (args: {
  inboxId: number
  seq?: number
  kind: string
  event?: EventBody
  message?: MessageSeed
  attachments?: readonly Attachment[]
}): PendingInputsState['pending'][number] => ({
  inboxId: args.inboxId,
  seq: args.seq ?? args.inboxId,
  at: AT,
  kind: args.kind,
  ...(args.event === undefined ? {} : { event: args.event }),
  ...(args.message === undefined
    ? {}
    : {
        message: {
          text: args.message.text,
          clientId: args.message.clientId ?? `client-${args.inboxId}`,
          ...(args.message.via === undefined ? {} : { via: args.message.via }),
          ...(args.message.sender === undefined ? {} : { sender: args.message.sender }),
          ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
        },
      }),
})

const message = (args: {
  inboxId: number
  text: string
  attachments?: readonly Attachment[]
}): PendingInputsState['pending'][number] =>
  input({
    inboxId: args.inboxId,
    kind: 'message',
    message: { text: args.text },
    ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
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
    message({ inboxId: 3, text: 'also dim the timestamp' }),
    input({ inboxId: 5, kind: 'event', event: prEvent }),
    input({ inboxId: 7, kind: 'event', event: agentEnded }),
    input({ inboxId: 9, kind: 'event', event: restartingService }),
  ],
}

const rows = queuedRowsOf({ pending, events: [], staged: [] })

const turnOf = (id: string): Turn | undefined => rows.find((row) => row.id === id)?.turn

const textOf = (turn: Turn | undefined): string | undefined =>
  turn?.kind === ETurnKind.User ? turn.item.text : undefined

describe('queuedRowsOf', () => {
  it('walks the pending inputs in seq order and maps each to the turn it becomes', () => {
    expect(rows.map((row) => [row.id, row.turn.kind])).toEqual([
      ['client-3', ETurnKind.User],
      ['queued-5', ETurnKind.Notice],
      ['queued-7', ETurnKind.Report],
    ])
  })

  it('keys the user row by its clientId and carries the text as the landed message does', () => {
    expect(textOf(turnOf('client-3'))).toBe('also dim the timestamp')
  })

  it('offers withdraw with the inbox id for an operator message', () => {
    const queued = rows.find((row) => row.id === 'client-3')

    expect(queued?.withdraw).toEqual({ inboxId: '3', disabled: false })
  })

  it('keeps the attachments the landed message carries', () => {
    const picture: Attachment = {
      id: 'att-1',
      name: 'shot.png',
      mediaType: 'image/png',
      size: 12,
      content: { store: EAttachmentStore.Media, hash: 'b'.repeat(64) },
    }
    const [row] = queuedRowsOf({
      pending: { pending: [message({ inboxId: 4, text: 'look', attachments: [picture] })] },
      events: [],
      staged: [],
    })

    expect(row?.turn.kind === ETurnKind.User ? row.turn.item.attachments : undefined).toEqual([
      picture,
    ])
  })

  it('renders a message from another session as the agent turn it lands as', () => {
    const [row] = queuedRowsOf({
      pending: {
        pending: [
          input({
            inboxId: 4,
            kind: 'message',
            message: {
              text: 'rebase onto main',
              clientId: 'client-4',
              via: EMessageOrigin.PeerAgent,
              sender: { session: 'ses_2' },
            },
          }),
        ],
      },
      events: [],
      staged: [],
      sessionNameOf: (id) => (id === 'ses_2' ? 'Fix login' : undefined),
    })

    const caption =
      row?.turn.kind === ETurnKind.Agent
        ? row.turn.segments.find((segment) => segment.kind === ESegmentKind.Message)
        : undefined

    expect(row?.turn.kind).toBe(ETurnKind.Agent)
    expect(caption?.kind === ESegmentKind.Message ? caption.item.sender : undefined).toBe(
      'From Fix login',
    )
    expect(row?.withdraw).toBeUndefined()
  })

  it('leaves out a pending message the optimistic row already shows', () => {
    const hidden = queuedRowsOf({
      pending,
      events: [],
      staged: [],
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
    const turn = turnOf('queued-5')

    expect(turn?.kind === ETurnKind.Notice ? turn.item.title : undefined).toBe(postedTitle)
  })

  it('carries the agent report of an ended sub-agent', () => {
    const turn = turnOf('queued-7')

    expect(turn?.kind === ETurnKind.Report ? turn.item.report : undefined).toBe(
      'The queued notice now renders through TranscriptNotice.',
    )
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

  it('renders a staged message as the user turn it will land as, with withdraw disabled', () => {
    const [row] = queuedRowsOf({ pending: { pending: [] }, events: [], staged: [staged] })

    expect(row?.id).toBe('client-a')
    expect(row?.turn.kind).toBe(ETurnKind.User)
    expect(textOf(row?.turn)).toBe('ship the dimmer')
    expect(row?.withdraw).toEqual({ inboxId: 'client-a', disabled: true })
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
