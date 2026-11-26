import {
  EAgentStatus,
  EResumeOutcome,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Hash,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_MCP_CONTROL,
  EMPTY_MESSAGES,
  EMPTY_POD_RESOURCES,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  UNVERSIONED_SETTINGS,
  type PluginPodContext,
  type PodCrew,
  type SubagentSnapshot,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallResult } from '@dltech/atlas-protocol'

export const startedAt = '2026-11-09T10:00:00.000Z'

export const snapshotOf = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'trace the port',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt,
  ...overrides,
})

export type Call = { method: string; args: unknown }

export const fakeCrew = (args: { queued?: boolean; held?: readonly SubagentSnapshot[] } = {}) => {
  const calls: Call[] = []
  const port: PodCrew = {
    spawn: async (spawnArgs) => {
      calls.push({ method: 'spawn', args: spawnArgs })
      return snapshotOf({ agentType: spawnArgs.agentType, intent: spawnArgs.intent })
    },
    say: async (sayArgs) => {
      calls.push({ method: 'say', args: sayArgs })
      return { queued: args.queued ?? true, snapshot: snapshotOf({ agentId: sayArgs.agentId }) }
    },
    stop: async (stopArgs) => {
      calls.push({ method: 'stop', args: stopArgs })
      return snapshotOf({ agentId: stopArgs.agentId, status: EAgentStatus.Stopped })
    },
    resume: async (resumeArgs) => {
      calls.push({ method: 'resume', args: resumeArgs })
      return EResumeOutcome.Resumed
    },
    list: () => args.held ?? [],
    report: async (reportArgs) => {
      calls.push({ method: 'report', args: reportArgs })
      return snapshotOf({ agentId: 'main' })
    },
  }
  return { port, calls }
}

export const withEvents = (args: {
  ctx: PluginPodContext
  events: readonly RecordEvent[]
}): PluginPodContext => ({ ...args.ctx, events: () => args.events })

const HASH = 'a'.repeat(64) as Hash

export const eventLog = () => {
  let seq = 0
  const envelope = () => {
    seq += 1
    return {
      id: toEventId(`event-${seq}`),
      seq,
      threadId: toThreadId('t1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: startedAt,
      epoch: 1,
      prevHash: HASH,
    }
  }
  return {
    called: (args: { name: string; ordinal: number }): RecordEvent => ({
      ...envelope(),
      type: 'tool-called',
      callId: toCallId(`call-${seq}`),
      name: args.name,
      input: {},
      ordinal: args.ordinal,
    }),
    said: (): RecordEvent => ({
      ...envelope(),
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'a step' }],
    }),
    resulted: (args: { name: string }): RecordEvent => ({
      ...envelope(),
      type: 'tool-result',
      callId: toCallId(`call-${seq}`),
      name: args.name,
    }),
  }
}

export const rig = (crew: PodCrew) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew,
    messages: EMPTY_MESSAGES,
    classifier: EMPTY_CLASSIFIER,
    analytics: EMPTY_ANALYTICS,
    resources: EMPTY_POD_RESOURCES,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      mcp: EMPTY_MCP_CONTROL,
      gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      memory: {
        list: async () => ({ project: null, group: null, memories: [] }),
        read: async () => null,
        write: async () => {
          throw new Error('this rig writes no memory')
        },
        edit: async () => {
          throw new Error('this rig edits no memory')
        },
        delete: async () => false,
      },
    },
    append: async () => undefined,
    notify: async () => undefined,
    events: () => [],
    call: async () =>
      ({
        status: ECallStatus.Failed,
        op: 'readDirectory',
        error: { code: 'not-found', message: 'this rig has no repository' },
      }) as CallResult,
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}
