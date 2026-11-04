import { toThreadId, type ModelPort } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { SequentialIds, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { createInMemoryDaemon, type InMemoryDaemon } from '@dltech/atlas-protocol/testing'

import type { PrepareResult } from '../ports'
import { SessionHolder } from '../session-holder'
import { FakeBus, FakeClock, flushUntil, SANDBOX, SECRET, SESSION, THREAD } from './rig-fakes'
import { makeRuntimeFactory, type RigRuntime, type ScriptRef } from './rig-runtime'

export { FakeBus, FakeClock, flushUntil, SANDBOX, SECRET, SESSION, THREAD }
export type { RigRuntime, ScriptRef }

export const THREAD_ID = toThreadId(THREAD)

export type HolderRig = {
  plane: ControlPlane
  bus: FakeBus
  clock: FakeClock
  wakeCount(sessionId: string): number
  ids: SequentialIds
  holder: SessionHolder
  daemon: InMemoryDaemon
  script: ScriptRef
  runtimes: RigRuntime[]
  post(text: string): Promise<{ inboxId: number }>
  postStop(): Promise<{ inboxId: number }>
  wake(): Promise<void>
  flush(): Promise<void>
  runCount(): number
  events(): Promise<{ type: string; seq: number; epoch: number; bootId?: string | null }[]>
}

export const makeRig = async (args: {
  holderId?: string | undefined
  script?: readonly ScriptedModelStep[] | undefined
  daemon?: InMemoryDaemon | undefined
  clock?: FakeClock | undefined
  bus?: FakeBus | undefined
  plane?: ControlPlane | undefined
  maxSessions?: number | undefined
  ttlMs?: number | undefined
  renewEveryMs?: number | undefined
  fenceMarginMs?: number | undefined
  idleMinutes?: number | undefined
  watchedRepos?: (() => Promise<readonly string[]>) | undefined
  model?: (() => ModelPort) | undefined
  prepare?: (() => Promise<PrepareResult>) | undefined
  connectGate?: Promise<void> | undefined
}): Promise<HolderRig> => {
  const clock = args.clock ?? new FakeClock()
  const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
  const plane = args.plane ?? new ControlPlane({ store })
  const bus = args.bus ?? new FakeBus()
  const ids = new SequentialIds()
  const daemon =
    args.daemon ??
    (await createInMemoryDaemon({ version: 'test', sandboxName: SANDBOX, secret: SECRET }))
  const script: ScriptRef = { current: args.script ?? [{ text: 'ok' }] }
  const runtimes: RigRuntime[] = []
  const runtimeFor = makeRuntimeFactory({
    daemon,
    clock,
    script,
    runtimes,
    watchedRepos: args.watchedRepos,
    model: args.model,
    prepare: args.prepare,
    connectGate: args.connectGate,
  })

  const holder = new SessionHolder({
    holderId: args.holderId ?? 'holder-a',
    plane,
    bus,
    timers: clock,
    runtimes: runtimeFor,
    ids,
    maxSessions: args.maxSessions ?? 4,
    ttlMs: args.ttlMs ?? 30_000,
    renewEveryMs: args.renewEveryMs ?? 5_000,
    fenceMarginMs: args.fenceMarginMs ?? 5_000,
    idleMinutes: args.idleMinutes ?? 30,
  })

  return {
    plane,
    bus,
    clock,
    wakeCount: (sessionId) => store.wakeCount(sessionId),
    ids,
    holder,
    daemon,
    script,
    runtimes,
    post: (text) =>
      plane.post({ sessionId: SESSION, kind: 'message', payload: JSON.stringify({ text }) }),
    postStop: () => plane.post({ sessionId: SESSION, kind: 'stop', payload: '{}' }),
    wake: () => bus.wake(SESSION),
    flush: async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    },
    runCount: () => daemon.runCount(),
    events: async () => {
      const out: { type: string; seq: number; epoch: number; bootId?: string | null }[] = []
      let afterSeq = 0
      for (;;) {
        const page = await plane.readEvents({
          threadId: THREAD_ID,
          afterSeq,
          limit: 1000,
          visible: false,
        })
        for (const event of page.events) {
          out.push({
            type: event.type,
            seq: event.seq,
            epoch: event.epoch,
            ...(event.type === 'tool-dispatched' ? { bootId: event.bootId ?? null } : {}),
          })
        }
        if (page.next === undefined) return out
        afterSeq = page.next
      }
    },
  }
}

export const seedSession = async (rig: HolderRig): Promise<void> => {
  await rig.plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
}

export const postAndRun = async (rig: HolderRig, text: string): Promise<{ inboxId: number }> => {
  const posted = await rig.post(text)
  await rig.wake()
  await rig.flush()
  return posted
}
