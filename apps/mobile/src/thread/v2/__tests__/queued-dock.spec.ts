import { describe, expect, it } from 'bun:test'

import {
  EMergeQueueMove,
  EPrEventKind,
  ESessionStatus,
  type PendingInputsState,
} from '@dltech/atlas-core'
import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { QUEUED_LABEL, queuedDockOf, queuedLabelOf } from '../queued-dock'

const LEASE = { epoch: 1, holderHostId: 1, live: true }

const working: SessionSnapshot['status'] = { state: ESessionStatus.Thinking, lease: LEASE }

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

const STAGED = [{ clientId: 'phone-1', text: 'from the phone', attachments: [] }]

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

describe('queuedDockOf', () => {
  it('lists server-queued messages first, then the ones this phone staged', () => {
    const dock = queuedDockOf({
      snapshot: { pending, events: [], status: working },
      staged: STAGED,
    })
    expect(dock.messages.map((message) => message.text)).toEqual([
      'from the laptop',
      'from the phone',
    ])
    expect([...dock.stagedIds]).toEqual(['phone-1'])
  })

  it('keeps queued notices apart from messages', () => {
    const dock = queuedDockOf({ snapshot: { pending, events: [], status: working }, staged: [] })
    expect(dock.notices.map((notice) => notice.id)).toEqual(['5'])
  })

  it('leaves a staged message to the transcript while the agent is idle', () => {
    const dock = queuedDockOf({
      snapshot: { pending: { pending: [] }, events: [], status: undefined },
      staged: STAGED,
    })
    expect(dock.messages).toEqual([])
  })

  it('reads the blocking command off the status', () => {
    const dock = queuedDockOf({
      snapshot: { pending: { pending: [] }, events: [], status: blocking },
      staged: [],
    })
    expect(dock.blocking?.name).toBe('summarise')
  })
})

describe('queuedLabelOf', () => {
  it('says what a queued message waits for while a command holds the turn', () => {
    const dock = queuedDockOf({
      snapshot: { pending, events: [], status: blocking },
      staged: STAGED,
    })
    expect(queuedLabelOf(dock)).toBe('Waits for the summary')
  })

  it('keeps the generic label when nothing blocks', () => {
    expect(queuedLabelOf({ blocking: undefined })).toBe(QUEUED_LABEL)
  })
})
