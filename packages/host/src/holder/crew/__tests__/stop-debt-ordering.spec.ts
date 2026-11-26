import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  ToolDefinition,
  defaultPipeline,
  refKey,
  toRunId,
  toThreadId,
  type ModelPort,
  type ModelRef,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { ScriptedModel, SequentialIds, fakeToolRegistry } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { scopeKeyOf } from '../../../calls/call-scope'
import { RemoteCalls } from '../../../calls/remote-calls'
import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { HostTimers, SessionRuntime } from '../../ports'
import { SessionRecord } from '../../record/record-adapter'
import { CrewRoom } from '../crew-room'

const SESSION = 'session-stop-debt'
const PARENT = toThreadId('thread-stop-parent')
const AT = '2026-11-26T12:00:00.000Z'
const CALL_A = 'call-a'
const HANG_A = 'stop_debt_hang_a'

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

const runtimeOf = (args: { model: ModelPort; tools: readonly ToolDefinition[] }): SessionRuntime =>
  ({
    model: args.model,
    modelOf: () => args.model,
    modelChoice: RIG_MODEL_CHOICE,
    choiceFor: (request: { root?: typeof RIG_MODEL_CHOICE }) => request.root ?? RIG_MODEL_CHOICE,
    modelLabelOf: (ref: ModelRef) => refKey(ref),
    tools: fakeToolRegistry(args.tools),
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
    remoteCalls: remoteCallsOf(),
  }) as unknown as SessionRuntime

const remoteCallsOf = (): RemoteCalls =>
  new RemoteCalls({
    sessionId: SESSION,
    token: 'token',
    connector: async () => {
      throw new Error('the record never reaches the sandbox')
    },
    timers,
    onFenced: () => undefined,
  })

class HangTool extends ToolDefinition {
  readonly description = 'starts and never settles'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({})

  constructor(readonly name: string) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    return await new Promise<ToolOutcome>(() => undefined)
  }
}

type DispatchGate = {
  holds(events: readonly unknown[]): boolean
  reached(): boolean
  arrive(): Promise<void>
  release(): void
}

const dispatchGateOf = (names: ReadonlySet<string>): DispatchGate => {
  let arrived = false
  const waiting: (() => void)[] = []
  return {
    holds: (events) =>
      events.some((event) => {
        const dispatched = event as { type?: unknown; name?: unknown }
        return (
          dispatched.type === 'tool-dispatched' &&
          typeof dispatched.name === 'string' &&
          names.has(dispatched.name)
        )
      }),
    reached: () => arrived,
    arrive: async () => {
      arrived = true
      await new Promise<void>((resolve) => waiting.push(resolve))
    },
    release: () => {
      for (const resolve of waiting.splice(0)) resolve()
    },
  }
}

const gatedPlane = (args: { plane: ControlPlane; gate: DispatchGate }): ControlPlane =>
  new Proxy(args.plane, {
    get: (target, property) => {
      const value = Reflect.get(target, property)
      if (property !== 'append') return typeof value === 'function' ? value.bind(target) : value
      return async (params: Parameters<ControlPlane['append']>[0]) => {
        if (args.gate.holds(params.events)) await args.gate.arrive()
        return target.append(params)
      }
    },
  })

const waitUntil = async (check: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('the child never reached the expected state')
}

const factKeysOf = (record: SessionRecord): readonly string[] =>
  record
    .eventCache()
    .eventsAfter(0)
    .flatMap((event) => (event.type === 'fact-recorded' ? [event.key] : []))

const dispatchedScopesOf = async (args: {
  plane: ControlPlane
  threadId: ThreadId
}): Promise<readonly string[]> => {
  const read = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 500,
    visible: false,
  })
  return read.events
    .filter((event) => event.type === 'tool-dispatched')
    .map((event) => scopeKeyOf({ runId: event.runId, callId: event.callId }))
}

const rigOf = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => new Date(AT).toISOString() }),
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: PARENT,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const parent = await SessionRecord.open({
    plane,
    threadId: PARENT,
    epoch: lease.epoch,
    timers,
    remoteCalls: remoteCallsOf(),
    daemonTools: new Set<string>(),
    nowIso: () => AT,
  })
  const gate = dispatchGateOf(new Set([HANG_A]))
  const model = new ScriptedModel([{ calls: [{ callId: CALL_A, name: HANG_A, input: {} }] }])
  const room = new CrewRoom({
    deps: depsOf(gatedPlane({ plane, gate })),
    runtime: runtimeOf({ model, tools: [new HangTool(HANG_A)] }),
    parentRecord: parent,
    parentThreadId: PARENT,
    epoch: lease.epoch,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })
  return { plane, parent, room, gate }
}

describe('the stop of a sub-agent', () => {
  it('resolves only once its stopped calls are owed in the parent record', async () => {
    const { plane, parent, room, gate } = await rigOf()
    const spawned = await room.spawn({
      agentType: 'general-purpose',
      intent: 'hold one call',
      prompt: 'run the call',
    })
    await waitUntil(() => gate.reached())

    let resolved = false
    const stopped = room.port().stop({ agentId: spawned.agentId })
    void stopped.then(() => {
      resolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(factKeysOf(parent)).toEqual([])
    expect(resolved).toBe(false)

    gate.release()
    await stopped

    const scopes = await dispatchedScopesOf({ plane, threadId: spawned.agentId as ThreadId })
    expect(scopes).toHaveLength(1)
    expect([...factKeysOf(parent)].sort()).toEqual(
      scopes.map((scope) => `stop-owed:${scope}`).sort(),
    )

    const result = await parent.append({
      threadId: PARENT,
      runId: toRunId('run-parent-result'),
      drafts: [{ type: 'user-said', text: 'the stop result' }],
    })
    const owedSeqs = parent
      .eventCache()
      .eventsAfter(0)
      .filter((event) => event.type === 'fact-recorded')
      .map((event) => event.seq)
    expect(result[0]?.seq).toBeGreaterThan(Math.max(...owedSeqs))
  })
})
