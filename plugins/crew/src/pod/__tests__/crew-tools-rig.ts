import { EAgentStatus } from '@dltech/atlas-core'
import {
  EMPTY_MCP_CONTROL,
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
    list: () => args.held ?? [],
    report: async (reportArgs) => {
      calls.push({ method: 'report', args: reportArgs })
      return snapshotOf({ agentId: 'main' })
    },
  }
  return { port, calls }
}

export const rig = (crew: PodCrew) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew,
    resources: EMPTY_POD_RESOURCES,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    control: {
      mcp: EMPTY_MCP_CONTROL,
      webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      memory: {
        list: async () => ({ project: null, memories: [] }),
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
