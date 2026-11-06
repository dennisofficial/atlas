import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { v2EventSchema, type V2Body } from '../event'
import {
  actionableInboxIds,
  EWorkspaceState,
  isWorkspacePrepared,
  workspaceStateOf,
} from '../workspace'
import { isRecordOnly, toLoopEvent } from '../loop-events'
import { decideHeldAction, EHeldAction } from '../../execution/held-session-decision'
import { NOW, runId, threadId } from './support'

const log = (bodies: V2Body[]) => chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const prepared: V2Body = { type: 'workspace-prepared' }
const failed = (inboxHead: number): V2Body => ({
  type: 'workspace-prepare-failed',
  reason: 'clone failed',
  inboxHead,
})
const said: V2Body = { type: 'user-said', text: 'hi' }

const state = (args: { bodies: V2Body[]; preparing?: boolean; pending?: number[] }) =>
  workspaceStateOf({
    events: log(args.bodies),
    preparing: args.preparing ?? false,
    pendingMessageIds: args.pending ?? [],
  })

describe('workspace events', () => {
  it('round-trips both events through the v2 event schema', () => {
    for (const body of [prepared, failed(2)]) {
      const [event] = log([body])
      expect(v2EventSchema.parse(event).type).toBe(body.type)
    }
  })

  it('rejects a failure without a reason', () => {
    const [event] = log([failed(1)])
    const { reason: _reason, ...rest } = event as Record<string, unknown>
    expect(v2EventSchema.safeParse(rest).success).toBe(false)
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

describe('a prepare that finished with warnings', () => {
  const warned: V2Body = { type: 'workspace-prepared', warnings: ['workspace clone failed: nope'] }

  it('round-trips the warnings through the v2 event schema', () => {
    const [event] = log([warned])
    expect(v2EventSchema.parse(event)).toMatchObject({ warnings: ['workspace clone failed: nope'] })
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
        idleDue: false,
        workspace: result.state,
        retryPending: result.retryPending,
      }),
    ).toBe(EHeldAction.StartTurn)
  })
})
