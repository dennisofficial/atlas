import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { recordEventSchema, type RecordEventBody } from '../event'
import {
  actionableInboxIds,
  EWorkspaceState,
  isWorkspacePrepared,
  preparedBeforeOf,
  workspaceStateOf,
} from '../workspace'
import { isRecordOnly, toLoopEvent } from '../loop-events'
import { decideHeldAction, EHeldAction } from '../../execution/held-session-decision'
import { NOW, runId, threadId } from './support'

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const prepared: RecordEventBody = { type: 'workspace-prepared' }
const failed = (inboxHead: number): RecordEventBody => ({
  type: 'workspace-prepare-failed',
  reason: 'clone failed',
  inboxHead,
})
const said: RecordEventBody = { type: 'user-said', text: 'hi' }

const state = (args: { bodies: RecordEventBody[]; preparing?: boolean; pending?: number[] }) =>
  workspaceStateOf({
    events: log(args.bodies),
    preparing: args.preparing ?? false,
    pendingMessageIds: args.pending ?? [],
  })

describe('workspace events', () => {
  it('round-trips both events through the v2 event schema', () => {
    for (const body of [prepared, failed(2)]) {
      const [event] = log([body])
      expect(recordEventSchema.parse(event).type).toBe(body.type)
    }
  })

  it('rejects a failure without a reason', () => {
    const [event] = log([failed(1)])
    const { reason: _reason, ...rest } = event as Record<string, unknown>
    expect(recordEventSchema.safeParse(rest).success).toBe(false)
  })

  it('records both events without showing them to the model', () => {
    const events = log([prepared, failed(1)])
    for (const event of events) {
      expect(isRecordOnly(event)).toBe(true)
      expect(toLoopEvent({ event })).toBeUndefined()
    }
  })
})

describe('isWorkspacePrepared', () => {
  it('is false for an empty log and for a log with only a failure', () => {
    expect(isWorkspacePrepared(log([]))).toBe(false)
    expect(isWorkspacePrepared(log([failed(0)]))).toBe(false)
  })

  it('is true once workspace-prepared exists, even after a failure', () => {
    expect(isWorkspacePrepared(log([failed(0), prepared]))).toBe(true)
  })

  it('counts a session that already has turns as prepared', () => {
    expect(isWorkspacePrepared(log([said]))).toBe(true)
  })
})

describe('preparedBeforeOf', () => {
  it('reads a prepare that succeeded', () => {
    expect(preparedBeforeOf(log([prepared]))).toBe(true)
  })

  it('does not read a message as a prepare', () => {
    expect(preparedBeforeOf(log([said]))).toBe(false)
  })

  it('does not read a failed prepare as a prepare', () => {
    expect(preparedBeforeOf(log([failed(1)]))).toBe(false)
  })
})

describe('workspaceStateOf', () => {
  it('is unprepared for a fresh log', () => {
    expect(state({ bodies: [] }).state).toBe(EWorkspaceState.Unprepared)
  })

  it('is preparing while a prepare runs', () => {
    expect(state({ bodies: [], preparing: true }).state).toBe(EWorkspaceState.Preparing)
  })

  it('is prepared after workspace-prepared', () => {
    expect(state({ bodies: [prepared] }).state).toBe(EWorkspaceState.Prepared)
  })

  it('is failed after a failure, with the reason', () => {
    const result = state({ bodies: [failed(1)], pending: [1] })
    expect(result.state).toBe(EWorkspaceState.Failed)
    expect(result.failure?.reason).toBe('clone failed')
    expect(result.retryPending).toBe(false)
  })

  it('asks for a retry only for a message newer than the failure', () => {
    expect(state({ bodies: [failed(1)], pending: [1, 2] }).retryPending).toBe(true)
    expect(state({ bodies: [failed(2)], pending: [1, 2] }).retryPending).toBe(false)
  })

  it('a later success supersedes the failure', () => {
    expect(state({ bodies: [failed(1), prepared], pending: [5] }).state).toBe(
      EWorkspaceState.Prepared,
    )
  })
})

describe('actionableInboxIds', () => {
  const entries = [
    { inboxId: 1, kind: 'message' },
    { inboxId: 2, kind: 'stop' },
    { inboxId: 3, kind: 'message' },
  ]

  it('keeps everything when there is no failure', () => {
    expect(actionableInboxIds({ entries, failure: undefined })).toEqual([1, 2, 3])
  })

  it('drops messages up to the failure head and keeps stops and newer messages', () => {
    expect(actionableInboxIds({ entries, failure: { inboxHead: 1 } })).toEqual([2, 3])
    expect(actionableInboxIds({ entries, failure: { inboxHead: 3 } })).toEqual([2])
  })
})

describe('a record that holds a message and no prepare', () => {
  const snapshotOf = (args: { preparing: boolean; pending: number[] }) => {
    const view = state({ bodies: [said], preparing: args.preparing, pending: args.pending })
    return {
      draining: false,
      turn: 'idle' as const,
      stopPending: false,
      messagePending: true,
      parked: false,
      resumable: false,
      idleDue: true,
      workspace: view.state,
      preparedBefore: preparedBeforeOf(log([said])),
      retryPending: view.retryPending,
    }
  }

  it('is unprepared, because only workspace-prepared makes a workspace prepared', () => {
    expect(state({ bodies: [said] }).state).toBe(EWorkspaceState.Unprepared)
  })

  it('prepares before it starts the turn', () => {
    expect(decideHeldAction(snapshotOf({ preparing: false, pending: [1] }))).toBe(
      EHeldAction.Prepare,
    )
  })

  it('waits for the first prepare instead of starting a resumable turn', () => {
    const snapshot = snapshotOf({ preparing: true, pending: [1] })
    expect(snapshot.workspace).toBe(EWorkspaceState.Preparing)
    expect(decideHeldAction(snapshot)).toBe(EHeldAction.Wait)
  })
})

describe('a prepare that finished with warnings', () => {
  const warned: RecordEventBody = {
    type: 'workspace-prepared',
    warnings: ['workspace clone failed: nope'],
  }

  it('round-trips the warnings through the v2 event schema', () => {
    const [event] = log([warned])
    expect(recordEventSchema.parse(event)).toMatchObject({
      warnings: ['workspace clone failed: nope'],
    })
  })

  it('is prepared, and a pending message starts a turn', () => {
    const result = state({ bodies: [warned], pending: [1] })
    expect(result.state).toBe(EWorkspaceState.Prepared)
    expect(result.failure).toBeUndefined()
    expect(
      decideHeldAction({
        draining: false,
        turn: 'idle',
        stopPending: false,
        messagePending: true,
        parked: false,
        resumable: false,
        idleDue: false,
        preparedBefore: true,
        workspace: result.state,
        retryPending: result.retryPending,
      }),
    ).toBe(EHeldAction.StartTurn)
  })
})
