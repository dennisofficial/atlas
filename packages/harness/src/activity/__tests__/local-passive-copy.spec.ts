import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERunner, toThreadId, toEventId, toRunId } from '@dltech/atlas-core'
import { EClientRequest, type ReadActivityReply, type WireEvent } from '@dltech/atlas-wire'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { registryFor } from '../../store/sessions/registry'
import { RandomIds } from '../../store/ids'
import { SystemClock } from '../../store/clock'
import { createFileActivityOutcomes } from '../file-outcomes'
import { createCurrentActivityValidator } from '../local-inspection'
import { createLocalActivityObserver } from '../local-observer'
import { createLocalThreadSummary } from '../local-summary'
import { createPassiveActivityConnection } from '../passive-activity-connection'
import { activitySocketFixture } from './activity-socket-fixture'

const threadId = toThreadId('root')
const snapshot: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 1,
  turnEpoch: 1,
  working: true,
  awaiting: null,
  observedOutcome: null,
}

test('passive Running observation uses existing local copy and delivers durable assistant unread without wake', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-passive-copy-'))
  const registry = registryFor({ home })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  await threads.create({ id: threadId, workspace: '/workspace', repo: null })
  await threads.chooseRunner({ threadId, runner: ERunner.Local })
  await threads.rename({ threadId, title: 'Host authority' })
  const socket = activitySocketFixture({ snapshot })
  const endpoint = { url: socket.url }
  const inspector = { inspect: async () => ({ state: 'running' as const, endpoint }) }
  const open = (args: Parameters<typeof createPassiveActivityConnection>[0]) =>
    createPassiveActivityConnection(args)
  const outcomes = createFileActivityOutcomes({
    pathFor: async () =>
      join(await registry.sessionDirFor({ threadId }), 'threads', 'root.activity.json'),
    validateCurrent: createCurrentActivityValidator({
      inspector,
      open: (args) => open({ ...args, token: () => 'existing-token' }),
    }),
  })
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector,
    outcomes,
    open: (args) => open({ ...args, token: () => 'existing-token', home: { path: home, threads } }),
  })
  const summary = createLocalThreadSummary({
    log,
    cursor: { readSeq: async () => 0 },
    activity: observer,
  })
  try {
    expect(await summary.read({ threadId, head: 0 })).toMatchObject({
      lastAssistantSeq: 0,
      status: { working: true },
    })
    const assistant: WireEvent = {
      id: 'assistant-1',
      threadId,
      runId: 'run-1',
      seq: 1,
      depth: 0,
      at: '2026-10-31T00:00:00.000Z',
      type: 'assistant-said',
      body: JSON.stringify({
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'Fresh reply' }],
      }),
    }
    socket.setEvents([assistant])
    socket.setSnapshot({
      ...snapshot,
      revision: 3,
      working: false,
      observedOutcome: { identity: { kind: 'run', runId: 'run-1' }, outcome: 'completed' },
    })
    const invalidated = socket.nextRead()
    socket.signal()
    await invalidated
    const refreshed = await summary.read({ threadId, head: 0 })
    expect(refreshed).toMatchObject({
      head: 1,
      lastAssistantSeq: 1,
      readSeq: 0,
      status: { lastAssistantSeq: 1, readSeq: 0, lastOutcome: 'completed', working: false },
    })
    expect((await threads.find({ threadId }))?.title).toBe('Host authority')
    await observer.close()
    const durableLog = new JsonlEventLog(home, registry, clock, ids)
    await durableLog.refresh({ threadId })
    expect((await durableLog.readOwn({ threadId })).map((event) => event.id)).toEqual([
      toEventId('assistant-1'),
    ])
    const stopped = createLocalActivityObserver({
      known: async () => true,
      inspector: { inspect: async () => ({ state: 'not-running' }) },
      outcomes,
      open: () => {
        throw new Error('Stopped must not open')
      },
    })
    expect(await stopped.read({ threadId, lastAssistantSeq: 1, readSeq: 0 })).toMatchObject({
      status: { lastOutcome: 'completed', working: false },
    })
    await stopped.close()
    expect(new Set(socket.requests)).toEqual(
      new Set([EClientRequest.ReadActivity, EClientRequest.ReadEvents, EClientRequest.ReadThread]),
    )
  } finally {
    await observer.close()
    await socket.stop()
    await rm(home, { recursive: true, force: true })
  }
})

test('an unanswered initial history copy is bounded and does not replace independently known home history', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-passive-copy-timeout-'))
  const registry = registryFor({ home })
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  await threads.create({ id: threadId, workspace: '/workspace', repo: null })
  await log.append({
    threadId,
    runId: toRunId('known-run'),
    drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'Known home reply' }] }],
  })
  const socket = activitySocketFixture({ snapshot, holdEvents: true })
  const connection = createPassiveActivityConnection({
    threadId,
    endpoint: { url: socket.url },
    token: () => 'existing-token',
    timeoutMs: 20,
    home: { path: home, threads },
    invalidate: () => undefined,
    disconnect: () => undefined,
  })
  try {
    await connection.settled().catch(() => undefined)
    await log.refresh({ threadId })
    expect((await log.readOwn({ threadId })).map((event) => event.seq)).toEqual([1])
    expect(socket.requests).toContain(EClientRequest.ReadEvents)
    await connection.close()
    await socket.whenEmpty()
    expect(socket.sockets.size).toBe(0)
  } finally {
    await connection.close()
    await socket.stop()
    await rm(home, { recursive: true, force: true })
  }
})
