import { describe, expect, it } from 'bun:test'

import {
  EMergeQueueMove,
  EMessageOrigin,
  EPrEventKind,
  ESessionStatus,
  type PendingInputsState,
} from '@dltech/atlas-core'
import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { EMessageAuthor, ERowKind, senderLabelOf, type MessageRow } from '../../rows'
import { QUEUED_LABEL, queuedDockOf, queuedLabelOf } from '../queued-dock'
import type { QueuedRow } from '../queued-rows'
import type { StagedSend } from '../staged-send'

const LEASE = { epoch: 1, holderHostId: 1, live: true }

const working: SessionSnapshot['status'] = { state: ESessionStatus.Thinking, lease: LEASE }

const NOW = Date.parse('2026-11-24T10:00:02.000Z')

const pending: PendingInputsState = {
  pending: [
    {
      inboxId: 4,
      seq: 4,
      at: '2026-11-23T10:00:00.000Z',
      kind: 'message',
      message: { text: 'from the laptop', clientId: 'web-1' },
    },
    {
      inboxId: 6,
      seq: 6,
      at: '2026-11-23T10:00:02.000Z',
      kind: 'message',
      message: {
        text: 'from another session',
        via: EMessageOrigin.PeerAgent,
        sender: { session: 'ses_peer' },
      },
    },
    {
      inboxId: 5,
      seq: 5,
      at: '2026-11-23T10:00:01.000Z',
      kind: 'event',
      event: {
        type: 'pr-event',
        repo: 'github.com/o/r',
        prNumber: 12,
        kind: EPrEventKind.MergeQueue,
        queue: EMergeQueueMove.Entered,
        url: 'https://github.com/o/r/pull/12',
      },
    },
  ],
}

const STAGED: readonly StagedSend[] = [
  { clientId: 'phone-1', text: 'from the phone', attachments: [] },
]

const SUMMARISE: SessionCommandRow = {
  inboxId: 9,
  name: 'summarise',
  postedAt: '2026-11-24T10:00:00.000Z',
  state: ECommandState.Running,
}

const blocking: SessionSnapshot['status'] = {
  state: ESessionStatus.RunningCommand,
  reason: 'summarise',
  since: '2026-11-24T10:00:01.000Z',
  lease: LEASE,
  commands: [SUMMARISE],
}

const dockOf = (args: {
  pending: PendingInputsState
  staged: readonly StagedSend[]
  status: SessionSnapshot['status']
}) =>
  queuedDockOf({
    snapshot: { pending: args.pending, events: [], status: args.status },
    staged: args.staged,
    now: NOW,
  })

const messageRow = (row: QueuedRow | undefined): MessageRow => {
  if (row === undefined) throw new Error('no queued row')
  if (row.row.kind !== ERowKind.Message) throw new Error(`row ${row.id} is ${row.row.kind}`)
  return row.row
}

describe('queuedDockOf', () => {
  it('lists server-queued inputs in inbox order, then the ones this phone staged', () => {
    const dock = dockOf({ pending, staged: STAGED, status: working })
    expect(dock.rows.map((row) => row.id)).toEqual(['web-1', 'queued-6', 'queued-5', 'phone-1'])
  })

  it('shows an operator message as the message it will become, with Edit and Remove', () => {
    const dock = dockOf({ pending, staged: [], status: working })
    const row = messageRow(dock.rows[0])
    expect(row.author).toBe(EMessageAuthor.You)
    expect(row.text).toBe('from the laptop')
    expect(dock.rows[0]?.withdraw).toEqual({ inboxId: '4', disabled: false })
  })

  it('shows a message from another session as agent speech, without Edit or Remove', () => {
    const dock = dockOf({ pending, staged: [], status: working })
    const peer = dock.rows.find((row) => row.id === 'queued-6')
    if (peer === undefined) throw new Error('no peer row')
    const row = messageRow(peer)
    expect(row.author).toBe(EMessageAuthor.Atlas)
    expect(row.text).toBe('from another session')
    expect(row.senderSessionId).toBe('ses_peer')
    expect(peer.withdraw).toBeUndefined()
  })

  it('names the session a peer message came from, and leaves it unnamed when unknown', () => {
    const dock = dockOf({ pending, staged: [], status: working })
    const peer = dock.rows.find((row) => row.id === 'queued-6')
    if (peer === undefined) throw new Error('no peer row')
    const row = messageRow(peer)
    expect(senderLabelOf({ row, sessionNameOf: () => 'Laptop session' })).toBe(
      'From Laptop session',
    )
    expect(senderLabelOf({ row })).toBe('From another session')
  })

  it('keeps a queued notice as the notice it will become', () => {
    const dock = dockOf({
      pending: { pending: [pending.pending[2]!] },
      staged: [],
      status: working,
    })
    const [row] = dock.rows
    expect(row?.row.kind).toBe(ERowKind.Notice)
    expect(row?.withdraw).toBeUndefined()
  })

  it('leaves a staged message to the transcript while the agent is idle', () => {
    const dock = dockOf({ pending: { pending: [] }, staged: STAGED, status: undefined })
    expect(dock.rows).toEqual([])
  })

  it('shows a staged message without actions until it settles', () => {
    const dock = dockOf({ pending: { pending: [] }, staged: STAGED, status: working })
    expect(messageRow(dock.rows[0])).toMatchObject({
      author: EMessageAuthor.You,
      text: 'from the phone',
    })
    expect(dock.rows[0]?.withdraw).toEqual({ inboxId: 'phone-1', disabled: true })
  })

  it('reads the blocking command off the status', () => {
    const dock = dockOf({ pending: { pending: [] }, staged: [], status: blocking })
    expect(dock.blocking?.name).toBe('summarise')
  })
})

describe('queuedLabelOf', () => {
  it('says what a queued message waits for while a command holds the turn', () => {
    const dock = dockOf({ pending, staged: STAGED, status: blocking })
    expect(queuedLabelOf(dock)).toBe('Waits for the summary')
  })

  it('keeps the generic label when nothing blocks', () => {
    expect(queuedLabelOf({ blocking: undefined })).toBe(QUEUED_LABEL)
  })
})
