import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'
import { EAgentStatus } from '@dltech/atlas-wire'

import { bindServeWriteBehind } from '../serve-write-behind'
import type { ServeApp } from '../serve-app'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { fakeServeApp } from './fakes'
import { trpcFailure, trpcOk, trpcUrl } from './trpc-fake'

const root = toThreadId('thread-root')
const controlPlaneUrl = 'https://api.example.com'
const env = {
  ATLAS_CLOUD_URL: controlPlaneUrl,
  ATLAS_SERVE_TOKEN: 'serve-token',
  ATLAS_API_PROVISIONED: '1',
}

const eventOf = (args: { threadId: ThreadId; seq: number }): Event =>
  ({
    id: toEventId(`ev-${args.threadId}-${args.seq}`),
    threadId: args.threadId,
    seq: args.seq,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-10-29T00:00:00.000Z',
    type: 'user-said',
    text: `m${args.seq}`,
  }) as Event

const agentOf = (agentId: ThreadId) => ({
  agentId,
  spawnedBy: root,
  agentType: 'explore',
  intent: 'look',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: '2026-10-29T00:00:00.000Z',
  endedAt: undefined,
})

const harness = (args: { counts: Record<string, number>; failRegister?: { times: number } }) => {
  const base = fakeServeApp({ threadId: root, root: '/workspace' })
  const registered: string[] = []
  const posted: { threadId: string | undefined; seqs: number[] }[] = []
  let agents: ReturnType<typeof agentOf>[] = []
  const listeners = new Set<() => void>()
  const app = {
    ...base,
    log: {
      ...base.log,
      readOwn: async (given: { threadId: ThreadId; fromSeq?: number }) =>
        Array.from({ length: args.counts[given.threadId] ?? 0 }, (_, i) =>
          eventOf({ threadId: given.threadId, seq: i + 1 }),
        ).filter((event) => event.seq > (given.fromSeq ?? 0)),
    },
    roster: {
      snapshot: () => ({ shells: [], agents, services: [] }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  } as unknown as ServeApp
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body))
    if (url === trpcUrl({ controlPlaneUrl, procedure: 'sandboxSelf.registerChild' })) {
      if ((args.failRegister?.times ?? 0) > 0) {
        args.failRegister!.times -= 1
        return trpcFailure({ status: 500 })
      }
      registered.push(body.threadId)
      return trpcOk({ head: 0 })
    }
    posted.push({ threadId: body.threadId, seqs: body.events.map((e: { seq: number }) => e.seq) })
    return trpcOk({ head: body.events.at(-1).seq })
  }) as unknown as typeof fetch
  const lines: ServeLogLine[] = []
  const behind = bindServeWriteBehind({
    env,
    app,
    threadId: root,
    durableHead: 0,
    remote: { controlPlaneUrl, token: 'serve-token', clientVersion: 'dev', fetchFn },
    log: (line) => lines.push(line),
  })
  return {
    behind,
    registered,
    posted,
    lines,
    spawn: (...ids: ThreadId[]) => {
      agents = ids.map(agentOf)
      for (const listener of listeners) listener()
    },
  }
}

const childA = toThreadId('child-a')
const childB = toThreadId('child-b')

describe('child write-behind', () => {
  it('registers a child spawned after bind and flushes it under its own threadId', async () => {
    const h = harness({ counts: { [root]: 1, [childA]: 3 } })
    h.spawn(childA)

    expect(await h.behind?.flush()).toBe(true)

    expect(h.registered).toEqual(['child-a'])
    expect(h.posted).toContainEqual({ threadId: 'child-a', seqs: [1, 2, 3] })
    expect(h.posted).toContainEqual({ threadId: undefined, seqs: [1] })
  })

  it('keeps independent seq spaces for two children', async () => {
    const h = harness({ counts: { [childA]: 2, [childB]: 4 } })
    h.spawn(childA, childB)

    await h.behind?.flush()

    expect(h.posted).toContainEqual({ threadId: 'child-a', seqs: [1, 2] })
    expect(h.posted).toContainEqual({ threadId: 'child-b', seqs: [1, 2, 3, 4] })
  })

  it('catches up a child already present at bind', async () => {
    const late = harness({ counts: { [childA]: 2 } })
    late.spawn(childA)

    expect(await late.behind?.flush()).toBe(true)
    expect(late.posted).toContainEqual({ threadId: 'child-a', seqs: [1, 2] })
  })

  it('retries a failed registration and reports false until it succeeds', async () => {
    const h = harness({ counts: { [childA]: 1 }, failRegister: { times: 2 } })
    h.spawn(childA)

    expect(await h.behind?.flush()).toBe(false)
    expect(h.lines.map((line) => line.event)).toContain(EServeEvent.EventFlushFailed)
    expect(await h.behind?.flush()).toBe(true)
    expect(h.registered).toEqual(['child-a'])
    expect(h.posted).toContainEqual({ threadId: 'child-a', seqs: [1] })
  })
})
