import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  INBOX_KIND_EVENT,
  chainEvents,
  defaultPipeline,
  refKey,
  toRunId,
  toThreadId,
  type InboxEntry,
  type ModelPort,
  type ModelRef,
  type ThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { ScriptedModel, SequentialIds, fakeToolRegistry } from '@dltech/atlas-agent/testing'

import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { HostTimers, SessionRuntime } from '../../ports'
import type { SessionRecord } from '../../record/record-adapter'
import { CrewRoom } from '../crew-room'
import type { OpenChild } from '../open-children'

const SESSION = 'session-order'
const PARENT = toThreadId('thread-order-parent')
const A = toThreadId('thread-order-a')
const B = toThreadId('thread-order-b')
const GROUP = 'call-1'
const AT = '2026-01-01T00:00:00.000Z'
const FINISHED_A: readonly RecordEventBody[] = [
  { type: 'user-said', text: 'child-a first pass' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'child-a done' }] },
  { type: 'input-consumed', inboxId: 7 },
]
const RESUMABLE_A: readonly RecordEventBody[] = [{ type: 'user-said', text: 'child-a long pass' }]
const RESUMABLE_B: readonly RecordEventBody[] = [{ type: 'user-said', text: 'child-b long pass' }]

const timers: HostTimers = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  random: () => 0.5,
}

const depsOf = (plane: ControlPlane): HeldSessionDeps =>
  ({
    sessionId: SESSION,
    plane,
    ids: new SequentialIds(),
    timers,
    appendRetryMs: 5,
    bus: {
      live: async () => undefined,
      panelHold: async () => undefined,
      onWake: () => () => undefined,
      onResync: () => () => undefined,
      onPanelHold: () => () => undefined,
    },
  }) as unknown as HeldSessionDeps

const runtimeOf = (model: ModelPort): SessionRuntime =>
  ({
    model,
    modelOf: () => model,
    modelChoice: RIG_MODEL_CHOICE,
    choiceFor: (request: { root?: typeof RIG_MODEL_CHOICE }) => request.root ?? RIG_MODEL_CHOICE,
    modelLabelOf: (ref: ModelRef) => refKey(ref),
    tools: fakeToolRegistry([]),
    daemonTools: new Set<string>(),
    effectOf: () => EToolEffect.Read,
    assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    normalizeFailure: ({ message }: { message: string }) => ({
      kind: EProviderFailureKind.Network,
      scope: EProviderFailureScope.Route,
      retry: EProviderRetry.Transient,
      message,
    }),
    launchDirectory: '/w',
    remoteCalls: {
      invoke: async () => {
        throw new Error('no daemon in this spec')
      },
      onEvent: () => () => undefined,
    },
  }) as unknown as SessionRuntime

const parentRecordOf = (): SessionRecord =>
  ({
    ownEvents: async () => [],
    eventCache: () => ({ eventsAfter: () => [], loopState: () => ({}) }),
    append: async () => [],
  }) as unknown as SessionRecord

const gateOf = () => {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open: () => open() }
}

const childModelsOf = (routes: readonly { needle: string; gate: Promise<void> }[]): ModelPort => {
  const models = routes.map((route) => ({
    ...route,
    model: new ScriptedModel([{ text: `${route.needle} answered` }]),
  }))
  return {
    identity: models[0]?.model.identity ?? { id: 'scripted', modelId: 'scripted-1' },
    step: async (stepArgs) => {
      const request = JSON.stringify(stepArgs.assembled)
      const route = models.find((candidate) => request.includes(candidate.needle)) ?? models[0]
      if (route === undefined) throw new Error('no scripted model serves this step')
      await route.gate
      return route.model.step(stepArgs)
    },
  }
}

const childOf = (agentId: ThreadId): OpenChild => ({
  agentId,
  agentType: 'explore',
  intent: 'order',
  group: GROUP,
  spawnedAt: AT,
  worktree: undefined,
})

const appendSeeded = async (args: {
  plane: ControlPlane
  threadId: ThreadId
  epoch: number
  bodies: readonly RecordEventBody[]
}): Promise<void> => {
  const outcome = await args.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: args.threadId,
      runId: toRunId(`run-${args.threadId}`),
      epoch: args.epoch,
      at: AT,
      bodies: args.bodies,
    }),
  })
  if (!outcome.ok) throw new Error(`seed refused: ${JSON.stringify(outcome.refusal)}`)
}

const endingAgentOf = (payload: string): ThreadId | undefined => {
  const parsed = JSON.parse(payload) as { event: { type: string; agentId?: string } }
  if (parsed.event.type !== 'agent-ended' || parsed.event.agentId === undefined) return undefined
  return parsed.event.agentId as ThreadId
}

const delayingPlane = (args: {
  plane: ControlPlane
  delayFor: ThreadId
  until: Promise<void>
  posted: (agentId: ThreadId) => void
}): ControlPlane =>
  new Proxy(args.plane, {
    get: (target, property) => {
      const value = Reflect.get(target, property)
      if (property !== 'post') return typeof value === 'function' ? value.bind(target) : value
      return async (message: Parameters<ControlPlane['post']>[0]) => {
        const agentId = endingAgentOf(message.payload)
        if (agentId !== undefined) args.posted(agentId)
        if (agentId === args.delayFor) await args.until
        return target.post(message)
      }
    },
  })

const rigOf = async (args: {
  model: ModelPort
  logs: readonly (readonly RecordEventBody[])[]
  delaying?:
    | { delayFor: ThreadId; until: Promise<void>; posted: (agentId: ThreadId) => void }
    | undefined
}) => {
  const store = new InMemoryControlStore({ clock: () => new Date().toISOString() })
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: PARENT,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const ids = [A, B]
  for (const [index, agentId] of ids.entries()) {
    await plane.createThread({ threadId: agentId, sessionId: SESSION })
    await appendSeeded({
      plane,
      threadId: agentId,
      epoch: lease.epoch,
      bodies: args.logs[index] ?? [],
    })
  }
  const wired = args.delaying === undefined ? plane : delayingPlane({ plane, ...args.delaying })
  const room = new CrewRoom({
    deps: depsOf(wired),
    runtime: runtimeOf(args.model),
    parentRecord: parentRecordOf(),
    parentThreadId: PARENT,
    epoch: lease.epoch,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })
  return { plane, room }
}

const endingsOf = async (
  plane: ControlPlane,
): Promise<{ agentId: string; held: boolean | undefined }[]> => {
  const entries: InboxEntry[] = await plane.readInbox({
    sessionId: SESSION,
    afterId: 0,
    limit: 100,
    forThread: null,
  })
  return entries.flatMap((entry) => {
    if (entry.kind !== INBOX_KIND_EVENT) return []
    const payload = JSON.parse(entry.payload) as {
      event: { type: string; agentId?: string; held?: boolean }
    }
    if (payload.event.type !== 'agent-ended') return []
    return [{ agentId: payload.event.agentId ?? '', held: payload.event.held }]
  })
}

const waitUntil = async (args: { check(): Promise<boolean> | boolean; timeoutMs: number }) => {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    if (await args.check()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return false
}

describe('an ending posted while its group still runs', () => {
  it('is held, because its run is registered before it posts', async () => {
    const gate = gateOf()
    const model = childModelsOf([{ needle: 'child-b', gate: gate.gate }])
    const { plane, room } = await rigOf({ model, logs: [FINISHED_A, RESUMABLE_B] })
    await room.adopt(childOf(B))
    expect(room.members().find((member) => member.agentId === B)?.running).toBe(true)
    await room.adopt(childOf(A))
    expect(await endingsOf(plane)).toEqual([{ agentId: A, held: true }])
    gate.open()
    await room.stopAll()
  })
})

describe('two endings posted at once', () => {
  it('commits them in the order they were decided, even when the first post is slow', async () => {
    const gateA = gateOf()
    const gateB = gateOf()
    const postA = gateOf()
    const attempted = { a: 0, b: 0 }
    const model = childModelsOf([
      { needle: 'child-a', gate: gateA.gate },
      { needle: 'child-b', gate: gateB.gate },
    ])
    const { plane, room } = await rigOf({
      model,
      logs: [RESUMABLE_A, RESUMABLE_B],
      delaying: {
        delayFor: A,
        until: postA.gate,
        posted: (agentId) => {
          if (agentId === A) attempted.a += 1
          else attempted.b += 1
        },
      },
    })
    await room.adopt(childOf(A))
    await room.adopt(childOf(B))

    gateA.open()
    expect(await waitUntil({ check: () => attempted.a > 0, timeoutMs: 2000 })).toBe(true)
    gateB.open()
    await waitUntil({ check: () => attempted.b > 0, timeoutMs: 300 })
    postA.open()

    await waitUntil({
      check: async () => (await endingsOf(plane)).length >= 2,
      timeoutMs: 2000,
    })
    expect((await endingsOf(plane)).map((ending) => ending.agentId)).toEqual([A, B])
    await room.stopAll()
  })
})
