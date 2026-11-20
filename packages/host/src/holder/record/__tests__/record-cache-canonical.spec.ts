import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'

import { RemoteCalls } from '../../../calls/remote-calls'
import { SessionRecord, type AppendBody } from '../record-adapter'
import { RecordCache } from '../record-cache'

const SESSION = 'session-1'
const THREAD = toThreadId('thread-1')
const AT = '2026-11-06T12:00:00.000Z'

const CALL = toCallId('call-1')
const READ_CALL = toCallId('call-2')

const timers = {
  now: () => Date.parse(AT),
  setTimeout: () => 0,
  clearTimeout: () => {},
  random: () => 0.5,
}

const remoteCallsOf = (): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('no daemon tool is appended by this spec')
    },
    timers,
    onFenced: () => {},
  })

const drafts = (): AppendBody[] => [
  { type: 'user-said', text: 'run the tests' },
  {
    type: 'assistant-said',
    parts: [
      {
        type: 'reasoning',
        text: 'the suite is the fastest signal',
        providerOptions: { anthropic: { zeta: 1, alpha: 2 } },
      },
      { type: 'text', text: 'running them' },
    ],
  },
  {
    type: 'tool-called',
    callId: CALL,
    name: 'bash',
    input: {
      path: 'packages/core/src/index.ts',
      command: 'bun test',
      nested: { zeta: 1, alpha: 2 },
    },
    ordinal: 0,
  },
  {
    type: 'tool-called',
    callId: READ_CALL,
    name: 'read',
    input: { offset: 10, limit: 20, path: 'src/a.ts' },
    ordinal: 1,
  },
  {
    type: 'tool-result',
    callId: CALL,
    name: 'bash',
    output: { stdout: 'ok', stderr: '', exitCode: 0, meta: { z: 1, a: 2 } },
  },
]

const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

const openRecord = (args: { plane: ControlPlane; epoch: number }): Promise<SessionRecord> =>
  SessionRecord.open({
    plane: args.plane,
    threadId: THREAD,
    epoch: args.epoch,
    timers,
    remoteCalls: remoteCallsOf(),
    daemonTools: new Set<string>(),
    nowIso: () => AT,
  })

const firstDifference = (left: string, right: string): string | undefined => {
  if (left === right) return undefined
  let index = 0
  while (index < left.length && left[index] === right[index]) index += 1
  const from = Math.max(0, index - 60)
  return [
    `offset ${index}`,
    `appending host: ${JSON.stringify(left.slice(from, index + 80))}`,
    `fresh host:     ${JSON.stringify(right.slice(from, index + 80))}`,
  ].join('\n')
}

describe('the appending host caches what a fresh host decodes', () => {
  it('hands the loop the same events', async () => {
    const { plane, epoch } = await openThread()
    const appending = await openRecord({ plane, epoch })
    await appending.append({ threadId: THREAD, runId: toRunId('run-1'), drafts: drafts() })

    const fresh = await RecordCache.load({ plane, threadId: THREAD })

    expect(appending.eventCache().visibleLoopEvents().length).toBe(drafts().length)
    expect(
      firstDifference(
        JSON.stringify(appending.eventCache().visibleLoopEvents()),
        JSON.stringify(fresh.visibleLoopEvents()),
      ),
    ).toBeUndefined()
  })

  it('builds the same loop state', async () => {
    const { plane, epoch } = await openThread()
    const appending = await openRecord({ plane, epoch })
    await appending.append({ threadId: THREAD, runId: toRunId('run-1'), drafts: drafts() })

    const fresh = await RecordCache.load({ plane, threadId: THREAD })

    expect(
      firstDifference(
        JSON.stringify(appending.eventCache().loopState()),
        JSON.stringify(fresh.loopState()),
      ),
    ).toBeUndefined()
  })

  it('returns the committed events in the decoded form the cache holds', async () => {
    const { plane, epoch } = await openThread()
    const appending = await openRecord({ plane, epoch })
    const committed = await appending.append({
      threadId: THREAD,
      runId: toRunId('run-1'),
      drafts: drafts(),
    })

    const fresh = await RecordCache.load({ plane, threadId: THREAD })

    expect(
      firstDifference(JSON.stringify(committed), JSON.stringify(fresh.visibleLoopEvents())),
    ).toBeUndefined()
  })
})
