import type { ThreadId } from '@dltech/atlas-core'
import { toThreadId } from '@dltech/atlas-core'
import { FakeContextContentStore } from '@dltech/atlas-control/testing'
import { describe, expect, it } from 'bun:test'

import {
  announceChanged,
  fakeFs,
  putFile,
  rig as contextRig,
  rowsOf,
  SESSION,
  settle,
  until,
} from '../context/__tests__/context-mirror-rig'
import type { BranchObserver } from '../branch-observer'
import type { HeldSessionDeps } from '../held-session-deps'
import { HeldObservation } from '../held-observation'
import type { SessionRuntime } from '../ports'
import type { AppendBody, SessionRecord } from '../record/record-adapter'

const THREAD_ID: ThreadId = toThreadId('thread-context-mirror')
const WATCH_ID = `context-${SESSION}`

const observationOf = async (args: {
  fs: ReturnType<typeof fakeFs>
  content: FakeContextContentStore
}) => {
  const { calls, plane } = await contextRig({ fs: args.fs, content: args.content })
  const appends: AppendBody[][] = []
  const deps = {
    sessionId: SESSION,
    plane,
    ids: { nextRunId: () => 'run-context' },
    timers: { now: () => Date.now(), setTimeout, clearTimeout },
    contextMirror: { content: args.content, contextDir: () => args.fs.root },
  } as unknown as HeldSessionDeps
  const record = {
    append: async (call: { drafts: readonly AppendBody[] }) => {
      appends.push([...call.drafts])
      return []
    },
  } as unknown as SessionRecord
  const observation = new HeldObservation({
    deps,
    runtime: { remoteCalls: calls } as unknown as SessionRuntime,
    record,
    threadId: THREAD_ID,
    branches: { refresh: async () => undefined, stop: () => {} } as unknown as BranchObserver,
  })
  return { observation, appends, plane }
}

describe('HeldObservation context mirror', () => {
  it('mirrors at start and again when a turn ends', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { observation, appends, plane } = await observationOf({
      fs,
      content: new FakeContextContentStore({ clock: () => 1 }),
    })

    observation.start()
    await until(async () => (await rowsOf({ plane })).length === 1)

    putFile({ fs, path: 'later.md', text: 'two', mtimeMs: 1_700_000_002_000 })
    observation.turnEnded()
    await until(async () => (await rowsOf({ plane })).length === 2)

    expect(appends).toEqual([
      [{ type: 'context-changed', paths: ['notes.md'] }],
      [{ type: 'context-changed', paths: ['later.md'] }],
    ])
    await observation.stop()
  })

  it('rescans before it releases the lease and ignores events after that', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { observation, appends, plane } = await observationOf({
      fs,
      content: new FakeContextContentStore({ clock: () => 1 }),
    })
    observation.start()
    await until(async () => (await rowsOf({ plane })).length === 1)

    putFile({ fs, path: 'final.md', text: 'two', mtimeMs: 1_700_000_003_000 })
    await observation.observeBeforeRelease()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['final.md', 'notes.md'])
    expect(appends.at(-1)).toEqual([{ type: 'context-changed', paths: ['final.md'] }])

    const before = appends.length
    announceChanged({ fs, watchId: WATCH_ID, paths: ['final.md'] })
    await settle(1_200)

    expect(appends).toHaveLength(before)
    await observation.stop()
  })
})
