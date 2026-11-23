import {
  EMPTY_CREW,
  EMPTY_MESSAGES,
  EMPTY_CLASSIFIER,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  EMPTY_MCP_CONTROL,
  EMPTY_ROUTINES,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_POD_RESOURCES,
  UNVERSIONED_SETTINGS,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

export const podContextOf = (sessionId: string): PluginPodContext => ({
  sessionId,
  control: {
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
    mcp: EMPTY_MCP_CONTROL,
    webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
    gateway: { apiKey: async () => undefined },
    routines: EMPTY_ROUTINES,
    subscriptions: EMPTY_SUBSCRIPTIONS,
  },
  crew: EMPTY_CREW,
  messages: EMPTY_MESSAGES,
  classifier: EMPTY_CLASSIFIER,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  resources: EMPTY_POD_RESOURCES,
  append: async () => undefined,
  notify: async () => undefined,
  events: () => [],
  call: async (op: CallOp): Promise<CallResult> =>
    ({
      status: ECallStatus.Failed,
      op: op.op,
      error: { code: 'not-found', message: `this rig has no ${op.op}` },
    }) as CallResult,
  onDaemonEvent: () => () => undefined,
  live: () => undefined,
  log: () => undefined,
})
