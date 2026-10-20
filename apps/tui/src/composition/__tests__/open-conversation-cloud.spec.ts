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
import {
  fakeEventLog,
  fakeIds,
  fakeLedger,
  fakeThreadStore,
  FAKE_WORKSPACE,
  SPEC_SHARD,
} from './fake-backend'

const REMOTE_THREAD = toThreadId(`cloud-${SPEC_SHARD}`)

const HERE: WorkspaceIdentity = { workspace: FAKE_WORKSPACE, repo: null }

const AT = '2026-08-24T00:00:00.000Z'

const WIRE_ROW = {
  id: REMOTE_THREAD,
  title: 'cloud conversation',
  head: 1,
  createdAt: AT,
  updatedAt: AT,
  workspace: null,
  repo: null,
  executionLocation: EExecutionLocation.Cloud,
}

const said = (text: string, threadId: ThreadId = REMOTE_THREAD, seq = 1): Event => ({
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
    onThreadRenamed: () => () => undefined,
    onThreadModelChanged: () => () => undefined,
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

describe('attaching to a cloud session through the attach seam', () => {
  it('opens against refusing stores with no adopt, no lock, and no settle', async () => {
    const { stores } = refusingCloudStores({ events: [said('said inside the sandbox')] })

    const attached = await attachCloudSession({
      stores,
      threadId: REMOTE_THREAD,
      effects: () => undefined,
    })

    expect(attached.threadId).toBe(REMOTE_THREAD)
    expect(attached.started).toBe(true)
    expect(attached.name).toBe('cloud conversation')
    expect(attached.events).toHaveLength(1)
    expect(attached.events[0]?.type).toBe('user-said')
    expect(await lockHeld(REMOTE_THREAD)).toBe(false)
  })
})

describe('openConversation on a thread whose meta says cloud', () => {
  it('refuses the local open without claiming the session lock', async () => {
    const threads = fakeThreadStore({ existing: [REMOTE_THREAD], workspace: null })
    await threads.chooseExecutionLocation({ threadId: REMOTE_THREAD, location: EExecutionLocation.Cloud })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('said inside the sandbox')]),
      ledger: fakeLedger(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: REMOTE_THREAD },
    })

    expect('cloud' in outcome && outcome.threadId === REMOTE_THREAD).toBe(true)
    expect(await lockHeld(REMOTE_THREAD)).toBe(false)
    expect(threads.peekRow({ threadId: REMOTE_THREAD })?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('opens the mirrored transcript at boot and marks it for attach, never the lock', async () => {
    const threads = fakeThreadStore({ existing: [REMOTE_THREAD], workspace: null })
    await threads.chooseExecutionLocation({ threadId: REMOTE_THREAD, location: EExecutionLocation.Cloud })

    const outcome = await openConversation({
      threads,
      log: fakeEventLog([said('said inside the sandbox')]),
      ledger: fakeLedger(),
      ids: fakeIds(),
      workspace: HERE,
      effects: () => undefined,
      open: { mode: EOpenMode.Resume, threadId: REMOTE_THREAD },
      boot: true,
    })

    // A /restart relaunch resumes through this path: the transcript renders from the mirror at
    // once and the attach is the workspace's first act — an unstarted placeholder would leave
    // the welcome hero up for the whole wake, and forever if the attach fails.
    expect('cloud' in outcome).toBe(false)
    if (!('cloud' in outcome) && outcome.ok) {
      expect(outcome.conversation.threadId).toBe(REMOTE_THREAD)
      expect(outcome.conversation.started).toBe(true)
      expect(outcome.conversation.events.map((event) => event.type)).toEqual(['user-said'])
      expect(outcome.conversation.attachOnBoot).toBe(true)
    }
    expect(await lockHeld(REMOTE_THREAD)).toBe(false)
    expect(threads.peekRow({ threadId: REMOTE_THREAD })?.executionLocation).toBe(EExecutionLocation.Cloud)
  })
})
