import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { bindContextFilesMirror } from '../context-files-mirror'
import type { MirroredContextTree } from '../context-files-flush'
import type { ServeLogLine } from '../serve-log'

const threadId = toThreadId('thread-mirror')

const remote = {
  controlPlaneUrl: 'https://api.test',
  token: 'tok',
  clientVersion: 'test',
  fetchFn: fetch,
}

type FakeWatch = { fire: () => void }

const mirrorEnv = {
  ATLAS_CLOUD_URL: 'https://api.test',
  ATLAS_SERVE_TOKEN: 'tok',
}

const harness = (args?: { tree?: Record<string, string> }) => {
  const watchers: FakeWatch[] = []
  const scheduled: (() => void)[] = []
  let tree = new Map<string, string>(Object.entries(args?.tree ?? {}))
  const calls: { kind: string; path?: string; keep?: readonly string[] }[] = []
  const lines: ServeLogLine[] = []

  const clientCalls = calls
  const mirror = bindContextFilesMirror({
    env: mirrorEnv,
    threadId,
    sessionDir: '/sess',
    contextRoot: '/sess/context',
    remote,
    log: (line) => lines.push(line),
    put: async ({ path, content }) => {
      calls.push({ kind: 'put', path })
      void content
    },
    remove: async ({ path }) => {
      calls.push({ kind: 'delete', path })
    },
    deleteMissing: async ({ keep }) => {
      calls.push({ kind: 'resync', keep })
    },
    watchSeams: {
      watchPath: () => {
        const watcher: FakeWatch = { fire: () => undefined }
        watchers.push(watcher)
        return {
          on: () => undefined,
          close: () => undefined,
        }
      },
      schedule: ({ run }) => {
        scheduled.push(() => void run())
        return () => undefined
      },
      scanContext: async () => ({ signature: 'sig', capped: false }),
    },
    scan: async (): Promise<MirroredContextTree> => ({ textFiles: new Map(tree) }),
    debounceMs: 5,
    schedule: (task) => {
      scheduled.push(task)
      return () => undefined
    },
  })

  return {
    mirror,
    watchers,
    scheduled,
    calls: clientCalls,
    lines,
    setTree: (next: Record<string, string>) => {
      tree = new Map(Object.entries(next))
    },
    flushScheduled: () => {
      for (const run of scheduled.splice(0)) run()
    },
  }
}

describe('bindContextFilesMirror', () => {
  it('returns undefined when the serve does not mirror thread state', () => {
    expect(
      bindContextFilesMirror({
        env: {},
        threadId,
        sessionDir: '/sess',
        contextRoot: '/sess/context',
        remote,
        log: () => undefined,
      }),
    ).toBeUndefined()
  })

  it('does an initial catch-up flush', async () => {
    const env = harness({ tree: { 'plan.md': 'v1' } })
    expect(env.mirror).toBeDefined()
    const stored = await env.mirror?.flush()
    expect(stored).toBe(true)
  })

  it('debounces watcher changes into one flush per burst', async () => {
    const env = harness({ tree: { 'plan.md': 'v1' } })
    await env.mirror?.flush()

    env.setTree({ 'plan.md': 'v2' })
    env.watchers[0]?.fire()
    env.watchers[0]?.fire()
    env.watchers[0]?.fire()
    env.flushScheduled()
    const stored = await env.mirror?.flush()
    expect(stored).toBe(true)
  })
})
