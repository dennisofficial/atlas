import { describe, expect, it } from 'bun:test'

import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { transcriptEventsOf } from '@dltech/atlas-client/stream'
import { deriveTranscript } from '@dltech/atlas-client/transcript'
import {
  EMergeQueueMove,
  EMessageOrigin,
  EPrEventKind,
  ESessionStatus,
  type PendingInputsState,
} from '@dltech/atlas-core'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import {
  EMessageAuthor,
  ERowKind,
  rowsOf,
  senderLabelOf,
  type MessageRow,
  type ThreadRow,
} from '../../rows'
import { entryFolds, eventSchema } from '../registered-plugins'
import { QUEUED_LABEL, QUEUED_ROW_OPACITY, queuedDockOf, queuedLabelOf } from '../queued-dock'
import type { QueuedRow } from '../queued-rows'
import type { StagedSend } from '../staged-send'

const LEASE = { epoch: 1, holderHostId: 1, live: true }

const working: SessionSnapshot['status'] = { state: ESessionStatus.Thinking, lease: LEASE }

const NOW = Date.parse('2026-11-24T10:00:02.000Z')

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_1',
  runId: 'run_1',
  depth: 0,
  at: '2026-11-23T10:00:02.000Z',
  epoch: 0,
  prevHash: '0'.repeat(64),
})

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

const queuedRowOf = (rows: readonly QueuedRow[], id: string): MessageRow => {
  const queued = rows.find((row) => row.id === id)
  if (queued === undefined) throw new Error(`no queued row ${id}`)
  if (queued.row.kind !== ERowKind.Message) throw new Error(`row ${id} is ${queued.row.kind}`)
  return queued.row
}

const deliveredRowOf = (event: unknown): ThreadRow | undefined => {
  const model = deriveTranscript({
    events: transcriptEventsOf([eventSchema.parse(event)]),
    signals: [],
    pluginEntries: entryFolds,
    now: () => new Date(NOW),
  })
  return rowsOf({ entries: model.entries, working: false, now: NOW }).at(-1)
}

describe('queuedDockOf', () => {
  it('lists server-queued inputs in inbox order, then the ones this phone staged', () => {
    const dock = dockOf({ pending, staged: STAGED, status: working })
    expect(dock.rows.map((row) => row.id)).toEqual(['web-1', 'queued-6', 'queued-5', 'phone-1'])
  })

  it('derives every queued row through the transcript pipeline', () => {
    const dock = dockOf({ pending, staged: STAGED, status: working })
    expect(dock.rows.map((row) => row.row.kind)).toEqual([
      ERowKind.Message,
      ERowKind.Message,
      ERowKind.Notice,
      ERowKind.Message,
    ])
  })

  it('dims the rows it renders', () => {
    expect(QUEUED_ROW_OPACITY).toBe(0.5)
  })

  it('derives a queued peer message to the row a delivered one becomes', () => {
    const dock = dockOf({ pending, staged: [], status: working })
    const row = queuedRowOf(dock.rows, 'queued-6')
    const delivered = deliveredRowOf({
      ...envelope(6),
      type: 'user-said',
      text: 'from another session',
      via: EMessageOrigin.PeerAgent,
      sender: { session: 'ses_peer' },
    })
    expect(delivered?.kind).toBe(ERowKind.Message)
    if (delivered?.kind !== ERowKind.Message) return
    expect(row.author).toBe(EMessageAuthor.Atlas)
    expect({ ...row, id: delivered.id, at: delivered.at }).toEqual(delivered)
    expect(senderLabelOf({ row, sessionNameOf: () => 'Laptop session' })).toBe(
      'From Laptop session',
    )
    expect(senderLabelOf({ row })).toBe('From another session')
  })

  it('derives a queued operator message to the user row with the queued label', () => {
    const dock = dockOf({ pending, staged: [], status: blocking })
    const row = queuedRowOf(dock.rows, 'web-1')
    expect(row.author).toBe(EMessageAuthor.You)
    expect(row.text).toBe('from the laptop')
    expect(queuedLabelOf(dock)).toBe('Waits for the summary')
  })

  it('offers Edit and Remove for an operator message only', () => {
    const dock = dockOf({ pending, staged: STAGED, status: working })
    const withdrawOf = (id: string) => dock.rows.find((row) => row.id === id)?.withdrawInboxId
    expect(withdrawOf('web-1')).toBe(4)
    expect(withdrawOf('queued-6')).toBeUndefined()
    expect(withdrawOf('phone-1')).toBeUndefined()
  })

  it('drops the row of a message the operator is withdrawing', () => {
    const dock = queuedDockOf({
      snapshot: { pending, events: [], status: working },
      staged: STAGED,
      now: NOW,
      hiddenInboxIds: new Set([4]),
    })
    expect(dock.rows.map((row) => row.id)).toEqual(['queued-6', 'queued-5', 'phone-1'])
  })

  it('derives a queued notice to the notice row', () => {
    const dock = dockOf({
      pending: { pending: [pending.pending[2]!] },
      staged: [],
      status: working,
    })
    expect(dock.rows.map((row) => row.row.kind)).toEqual([ERowKind.Notice])
  })

  it('leaves a staged message to the transcript while the agent is idle', () => {
    const dock = dockOf({ pending: { pending: [] }, staged: STAGED, status: undefined })
    expect(dock.rows).toEqual([])
  })

  it('shows a staged message as the one it will become', () => {
    const dock = dockOf({ pending: { pending: [] }, staged: STAGED, status: working })
    expect(queuedRowOf(dock.rows, 'phone-1')).toMatchObject({
      author: EMessageAuthor.You,
      text: 'from the phone',
    })
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
