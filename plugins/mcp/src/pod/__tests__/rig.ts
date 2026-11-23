import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MESSAGES,
  EMPTY_CLASSIFIER,
  EMPTY_POD_RESOURCES,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodMcpControl,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'

import type { fakeDaemon } from './support'

export const rig = (
  daemon: ReturnType<typeof fakeDaemon>,
  over: { mcp?: PodMcpControl } = {},
): PluginPodContext => ({
  sessionId: 's1',
  workspaceDirectory: '/repo',
  control: over.mcp === undefined ? podControlStub : { ...podControlStub, mcp: over.mcp },
  resources: EMPTY_POD_RESOURCES,
  crew: EMPTY_CREW,
  messages: EMPTY_MESSAGES,
  classifier: EMPTY_CLASSIFIER,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  append: async () => undefined,
  notify: async () => undefined,
  events: () => [],
  call: (op) => daemon.call(op),
  live: () => undefined,
  onDaemonEvent: daemon.onDaemonEvent,
  log: () => undefined,
})

export const invocation = (input: unknown) => ({
  input,
  signal: new AbortController().signal,
  idempotencyKey: 'k',
  projectDirectory: '/repo',
  threadId: toThreadId('t1'),
})
