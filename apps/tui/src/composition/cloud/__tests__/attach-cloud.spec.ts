import { stat } from 'node:fs/promises'

import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  atlasDirectory,
  EClientRequest,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  sessionDirectory,
  sessionLockFile,
  type TurnSpend,
} from '@dltech/atlas-harness'

import { attachCloudSession } from '../attach-cloud'
import { FAKE_WORKSPACE, SPEC_SHARD } from '../../__tests__/fake-backend'

const LIFTED = toThreadId(`attach-${SPEC_SHARD}`)

const AT = '2026-08-24T00:00:00.000Z'

const WIRE_ROW = {
  id: LIFTED,
  title: 'lifted conversation',
  head: 2,
  createdAt: AT,
  updatedAt: AT,
  workspace: null,
  repo: null,
  executionLocation: EExecutionLocation.Cloud,
}

const WIRE_TURN = {
  runId: 'r1',
  threadId: LIFTED,
  status: 'completed',
  providerId: 'anthropic',
  modelId: 'claude-opus',
  steps: 1,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: AT,
  endedAt: AT,
  durationMs: 100,
}

const wireEventOf = (event: Event): Record<string, unknown> => {
  const { id, threadId, seq, runId, depth, at, ...body } = event
  return {
    id,
    threadId,
    seq,
    runId,
    depth,
    at,
    type: event.type,
    body: JSON.stringify(body),
  }
}

const said = (text: string, seq: number): Event => ({
  type: 'user-said',
  text,
  id: toEventId(`e-${seq}`),
  seq,
  threadId: LIFTED,
  runId: toRunId('r1'),
  depth: 0,
  at: AT,
})

const shellStarted = (seq: number): Event => ({
  type: 'background-shell-started',
  shellId: 'bash_1',
  command: 'bun run build',
  id: toEventId(`e-${seq}`),
  seq,
  threadId: LIFTED,
  runId: toRunId('r1'),
  depth: 0,
  at: AT,
})

const fakeChannel = (args: { events: readonly Event[] }) => ({
  request: async (request: { op: EClientRequest }): Promise<unknown> => {
    if (request.op === EClientRequest.ReadThread) return { thread: WIRE_ROW }
    if (request.op === EClientRequest.ReadEvents) {
      return { events: args.events.map(wireEventOf) }
    }
    if (request.op === EClientRequest.ReadTurns) return { own: [WIRE_TURN], delegated: [] }
    throw new Error(`unexpected channel op ${request.op}`)
  },
})

const attachOver = (args: { events: readonly Event[] }) => {
  const channel = fakeChannel(args)
  const stores = {
    threads: new RemoteThreadStore({ channel }),
    log: new RemoteEventLog({ channel }),
    ledger: new RemoteTurnLedger({ channel }),
  }
  return attachCloudSession({ stores, threadId: LIFTED, effects: () => undefined })
}

describe('attaching to a lifted session', () => {
  it('returns the transcript events, turns, name, and location from the remote stores', async () => {
    const attached = await attachOver({ events: [said('said inside the sandbox', 1)] })

    expect(attached.threadId).toBe(LIFTED)
    expect(attached.started).toBe(true)
    expect(attached.name).toBe('lifted conversation')
    expect(attached.executionLocation).toBe(EExecutionLocation.Cloud)
    expect(attached.events).toHaveLength(1)
    expect(attached.turns).toHaveLength(1)
    const turn = attached.turns[0] as TurnSpend
    expect(turn.modelId).toBe('claude-opus')
  })

  it('never adopts the thread, even with no workspace attribution behind it', async () => {
    await expect(attachOver({ events: [said('said inside the sandbox', 1)] })).resolves.toBeDefined()
  })

  it('claims no local session lock for a transcript the sandbox owns', async () => {
    await attachOver({ events: [said('said inside the sandbox', 1)] })

    const dir = sessionDirectory({ home: atlasDirectory(), sessionId: LIFTED })
    const locked = await stat(sessionLockFile({ sessionDir: dir })).then(
      () => true,
      () => false,
    )
    expect(locked).toBe(false)
  })

  it('settles no lost shells into a transcript it cannot write', async () => {
    const attached = await attachOver({
      events: [said('is my build still running', 1), shellStarted(2)],
    })

    expect(attached.events).toHaveLength(2)
  })
})
