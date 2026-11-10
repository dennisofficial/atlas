import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

export const podContextOf = (sessionId: string): PluginPodContext => ({
  sessionId,
  control: {
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
    webSearch: { config: async () => ({ backend: undefined, key: undefined }) },
  },
  crew: EMPTY_CREW,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  append: async () => undefined,
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
