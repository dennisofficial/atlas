import { stat } from 'node:fs/promises'

import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import {
  atlasDirectory,
  EClientRequest,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  sessionDirectory,
  sessionLockFile,
} from '@dltech/atlas-harness'

import { EOpenMode } from '../config'
import { openConversation } from '../open-conversation'
import { attachCloudSession } from '../cloud/attach-cloud'
import { fakeAgentRegistry } from './fake-agents'
import {
  fakeEventLog,
  fakeIds,
  fakeLedger,
  fakeThreadStore,
  FAKE_WORKSPACE,
  SPEC_SHARD,
} from './fake-backend'

const LIFTED = toThreadId(`lifted-${SPEC_SHARD}`)

const HERE: WorkspaceIdentity = { workspace: FAKE_WORKSPACE, repo: null }

const AT = '2026-08-24T00:00:00.000Z'

const WIRE_ROW = {
  id: LIFTED,
  title: 'lifted conversation',
  head: 1,
  createdAt: AT,
  updatedAt: AT,
  workspace: null,
  repo: null,
  executionLocation: EExecutionLocation.Cloud,
}

const said = (text: string, threadId: ThreadId = LIFTED, seq = 1): Event => ({
  type: 'user-said',
  text,
  id: toEventId(`e-${threadId}-${seq}`),
  seq,
  threadId,
  runId: toRunId('r1'),
  depth: 0,
  at: AT,
})

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

/**
 * The refusing stores the sandbox's serve hands an attaching client: reads cross the channel,
 * every mutation rejects. An attach that adopted, locked, or settled would fail here the way the
 * old readOnly stopgap would have failed in production the moment a branch slipped.
 */
const refusingCloudStores = (args: { events: readonly Event[] }) => {
  const channel = {
    request: async (request: { op: EClientRequest }): Promise<unknown> => {
      if (request.op === EClientRequest.ReadThread) return { thread: WIRE_ROW }
      if (request.op === EClientRequest.ReadEvents) {
        return { events: args.events.map(wireEventOf) }
      }
      if (request.op === EClientRequest.ReadTurns) return { own: [], delegated: [] }
      throw new Error(`unexpected channel op ${request.op}`)
    },
  }
  return {
    channel,
    stores: {
      threads: new RemoteThreadStore({ channel }),
      log: new RemoteEventLog({ channel }),
      ledger: new RemoteTurnLedger({ channel }),
    },
  }
}

const lockHeld = async (threadId: ThreadId): Promise<boolean> => {
  const dir = sessionDirectory({ home: atlasDirectory(), sessionId: threadId })
  return stat(sessionLockFile({ sessionDir: dir })).then(
    () => true,
    () => false,
  )
}

describe('attaching to a lifted session through the attach seam', () => {
  it('opens against refusing stores with no adopt, no lock, and no settle', async () => {
    const { stores } = refusingCloudStores({ events: [said('said inside the sandbox')] })

    const attached = await attachCloudSession({
      stores,
      threadId: LIFTED,
      effects: () => undefined,
    })

    expect(attached.threadId).toBe(LIFTED)
    expect(attached.started).toBe(true)
    expect(attached.name).toBe('lifted conversation')
    expect(attached.events).toHaveLength(1)
    expect(attached.events[0]?.type).toBe('user-said')
    expect(await lockHeld(LIFTED)).toBe(false)
  })
})

describe('openConversation after the readOnly stopgap is gone', () => {
  it('resumes a local thread by adopting an unattributed one and claiming its lock', async () => {
    const threads = fakeThreadStore({ existing: [LIFTED], workspace: null })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('from before the attribution')]),
      ledger: fakeLedger(),
      agents: fakeAgentRegistry(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: LIFTED },
    })

    expect(outcome.ok).toBe(true)
    expect(threads.peekRow({ threadId: LIFTED })?.workspace).toBe(FAKE_WORKSPACE)
    expect(await lockHeld(LIFTED)).toBe(true)
  })
})
