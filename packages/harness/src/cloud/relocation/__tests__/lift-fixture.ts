import {
  EAgentStatus,
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentSnapshot } from '../../../agents/registry/snapshot'
import {
  fakeEventLog,
  fakeThreadStore,
  type FakeEventLog,
  type FakeThreadStore,
} from './fake-backend'
import type { LiftAgentsPort } from '../lift-children'
import { ELiftStep, type LiftArgs } from '../lift'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge, type FakeBridge } from './fixture'

const AT = '2026-09-16T12:00:00.000Z'

let ids = 0

const fakeIds = (): IdPort => ({
  nextThreadId: () => CLOUD_THREAD,
  nextRunId: () => toRunId(`run_${(ids += 1)}`),
  nextEventId: () => {
    throw new Error('unused')
  },
  nextCallId: () => {
    throw new Error('unused')
  },
})

const said = (args: { seq: number; text: string }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`event_${args.seq}`),
  seq: args.seq,
  threadId: CLOUD_THREAD,
  runId: toRunId('run_local'),
  depth: 0,
  at: AT,
})

export const LOCAL_LOG: readonly Event[] = [
  said({ seq: 1, text: 'take the linter to zero' }),
  said({ seq: 2, text: 'and then ship it' }),
]

export const CHILD = toThreadId('child-1')
export const SETTLED_CHILD = toThreadId('child-done')

export const FOOTER_SELECTION = { ref: 'inference-net/kimi-k3-fast', effort: 'high' } as const

export type FakeLiftAgents = LiftAgentsPort & {
  readonly stopCalls: number
  readonly relocatedTo: readonly EExecutionLocation[]
  readonly resumed: readonly ThreadId[]
}

export const fakeLiftAgents = (children: readonly AgentSnapshot[] = []): FakeLiftAgents => {
  let stopCalls = 0
  const relocatedTo: EExecutionLocation[] = []
  const resumed: ThreadId[] = []

  return {
    list: () => children,
    stopChildren: async () => {
      stopCalls += 1
      return children
        .filter((child) => child.status === EAgentStatus.Running)
        .map((child) => child.agentId)
    },
    markChildrenRelocated: async ({ location }) => {
      relocatedTo.push(location)
    },
    forgetNotices: () => undefined,
    resume: async ({ agentId }) => {
      resumed.push(agentId)
      const snapshot = children.find((child) => child.agentId === agentId)
      if (snapshot === undefined) return { ok: false as const, reason: 'unknown agent' }
      return { ok: true as const, snapshot }
    },
    get stopCalls() {
      return stopCalls
    },
    get relocatedTo() {
      return relocatedTo
    },
    get resumed() {
      return resumed
    },
  }
}

export type Harness = {
  args: LiftArgs
  bridge: FakeBridge
  localThreads: FakeThreadStore
  localLog: FakeEventLog
  readonly located: readonly EExecutionLocation[]
  readonly steps: readonly ELiftStep[]
  readonly stops: number
  readonly interrupts: number
  readonly settleWaits: number
}

export const harness = (over: Partial<LiftArgs> & { bridge?: FakeBridge } = {}): Harness => {
  const bridge = over.bridge ?? fakeBridge()
  const localLog = fakeEventLog([...LOCAL_LOG])
  const localThreads = fakeThreadStore({ log: localLog, existing: [CLOUD_THREAD] })
  const located: EExecutionLocation[] = []
  const steps: ELiftStep[] = []
  let stops = 0
  let interrupts = 0
  let settleWaits = 0

  const args: LiftArgs = {
    threadId: CLOUD_THREAD,
    cwd: '/work',
    started: true,
    midTurn: false,
    interruptDeadlineMs: undefined,
    interrupt: () => {
      interrupts += 1
    },
    whenSettled: async () => {
      settleWaits += 1
    },
    identity: { workspace: '/work', repo: '/work' },
    title: null,
    model: FOOTER_SELECTION,
    bridge,
    localThreads,
    localLog,
    agents: fakeLiftAgents(),
    ids: fakeIds(),
    setLocation: (location) => located.push(location),
    stopLocal: async () => {
      stops += 1
      return { shells: ['bun run dev'], services: ['api'], drainNotices: () => [] }
    },
    capture: async () => CLEAN_WORKSPACE,
    onProgress: (step) => steps.push(step),
    captureContext: async () => undefined,
    ...over,
  }

  return {
    args,
    bridge,
    localThreads,
    localLog,
    located,
    steps,
    get stops() {
      return stops
    },
    get interrupts() {
      return interrupts
    },
    get settleWaits() {
      return settleWaits
    },
  }
}
