import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  EMPTY_PROMPT,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EToolEffect,
  defaultPipeline,
  refKey,
  toThreadId,
  type EventDraft,
  type ModelPort,
  type ModelRef,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'
import { ScriptedModel, SequentialIds, fakeToolRegistry } from '@dltech/atlas-agent/testing'

import { runInCallScope } from '../../../calls/call-scope'
import { RIG_MODEL_CHOICE } from '../../__tests__/rig-runtime'
import type { HeldSessionDeps } from '../../held-session-deps'
import type { HostTimers, SessionRuntime } from '../../ports'
import { RecordBookkeeping } from '../../record/record-bookkeeping'
import type { SessionRecord } from '../../record/record-adapter'
import { CrewRoom } from '../crew-room'

export const SESSION = 'session-spawn-step'
export const PARENT = toThreadId('thread-spawn-step-parent')
export const CALL = 'call-1'
export const AT = '2026-11-26T10:00:00.000Z'
export const BRIEF = 'SPAWN-BRIEF read the thing'
export const OTHER_BRIEF = 'SPAWN-BRIEF read the other thing'
export const CHILD_TEXT = 'SPAWN-ANSWER done'

export type ParentRecord = { record: SessionRecord; events: RecordEvent[] }

const timers: HostTimers = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  random: () => 0.5,
}

const childModelOf = (): ModelPort => new ScriptedModel([{ text: CHILD_TEXT }])

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

const parentRecordOf = (): ParentRecord => {
  const book = new RecordBookkeeping()
  const events: RecordEvent[] = []
  const record = {
    ownEvents: async () => [...events],
    eventCache: () => ({
      eventsAfter: () => [...events],
      loopEventsAfter: () => [],
      loopState: () => ({}),
      bookkeeping: () => book,
    }),
    append: async (args: { drafts: readonly EventDraft[] }) => {
      for (const draft of args.drafts) {
        const event = {
          ...draft,
          id: `e${events.length + 1}`,
          seq: events.length + 1,
          threadId: PARENT,
          at: AT,
        } as RecordEvent
        events.push(event)
        book.step(event)
      }
      return []
    },
  } as unknown as SessionRecord
  return { record, events }
}

const countingPlaneOf = (plane: ControlPlane): { plane: ControlPlane; created: string[] } => {
  const created: string[] = []
  const counting = new Proxy(plane, {
    get: (target, property) => {
      const value = Reflect.get(target, property)
      if (property !== 'createThread')
        return typeof value === 'function' ? value.bind(target) : value
      return async (params: { threadId: string; sessionId: string }) => {
        created.push(params.threadId)
        return target.createThread(params)
      }
    },
  })
  return { plane: counting, created }
}

export const roomOf = (args: {
  plane: ControlPlane
  parent: ParentRecord
  epoch: number
}): CrewRoom =>
  new CrewRoom({
    deps: depsOf(args.plane),
    runtime: runtimeOf(childModelOf()),
    parentRecord: args.parent.record,
    parentThreadId: PARENT,
    epoch: args.epoch,
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  })

export const rigOf = async () => {
  const store = new InMemoryControlStore({ clock: () => new Date().toISOString() })
  const bare = new ControlPlane({ store })
  await bare.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: PARENT,
  })
  const lease = await bare.grant({ sessionId: SESSION, hostId: 1 })
  const { plane, created } = countingPlaneOf(bare)
  const parent = parentRecordOf()
  const room = roomOf({ plane, parent, epoch: lease.epoch })
  return { plane: bare, created, parent, room, epoch: lease.epoch }
}

export const spawnInStep = <T>(body: () => Promise<T>): Promise<T> =>
  runInCallScope({ scopeKey: CALL, callId: CALL, body })

export const ofType = <T extends RecordEvent['type']>(
  events: readonly RecordEvent[],
  type: T,
): Extract<RecordEvent, { type: T }>[] =>
  events.filter((event): event is Extract<RecordEvent, { type: T }> => event.type === type)

const threadEventsOf = async (args: {
  plane: ControlPlane
  threadId: string
}): Promise<RecordEvent[]> => {
  const page = await args.plane.readEvents({
    threadId: args.threadId as ThreadId,
    afterSeq: 0,
    limit: 500,
    visible: false,
  })
  return [...page.events]
}

export const briefsOf = async (args: { plane: ControlPlane; agentId: string }): Promise<string[]> =>
  (await threadEventsOf({ plane: args.plane, threadId: args.agentId }))
    .flatMap((event) => (event.type === 'user-said' ? [event.text] : []))
    .filter((text) => text.includes('SPAWN-BRIEF'))

export const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
