import { EAgentStatus, toThreadId, type ActiveWorktree, type V2Event } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  type PluginPodContext,
  type PodCrew,
  type PodWorktrees,
  type SubagentSnapshot,
  type WorktreeListing,
  type WorktreeState,
} from '@dltech/atlas-plugin-sdk'

import { crewPod } from '..'

export const startedAt = '2026-11-09T10:00:00.000Z'

export const listing: WorktreeListing = {
  repository: '/work',
  worktrees: [
    { path: '/work', branch: 'main', isMain: true, bare: false, detached: false, prunable: false },
    {
      path: '/work/.atlas/worktrees/dennis/wt',
      branch: 'dennis/wt',
      isMain: false,
      bare: false,
      detached: false,
      prunable: false,
    },
    {
      path: '/work/.atlas/worktrees/dennis/detached',
      branch: null,
      isMain: false,
      bare: false,
      detached: true,
      prunable: false,
    },
  ],
}

export const cleanState: WorktreeState = {
  isClean: true,
  changedPaths: [],
  changedCount: 0,
  unpushed: { count: 0, against: 'origin/main' },
  upstream: 'origin/main',
  base: 'origin/main',
  behind: 0,
}

export const dirtyState: WorktreeState = {
  ...cleanState,
  isClean: false,
  changedPaths: ['src/a.ts'],
  changedCount: 1,
}

export const aheadState: WorktreeState = {
  ...cleanState,
  unpushed: { count: 1, against: 'origin/main' },
}

export const unknownPushState: WorktreeState = {
  ...cleanState,
  unpushed: null,
  upstream: undefined,
  base: undefined,
  behind: undefined,
}

export const event = (body: Record<string, unknown>): V2Event =>
  ({ ...body, seq: 1, at: startedAt, threadId: 't1', id: 'e1' }) as unknown as V2Event

export type Call = { method: string; args: unknown }

export const snapshotOf = (overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'work the branch',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt,
  ...overrides,
})

export const fakeCrew = () => {
  const calls: Call[] = []
  const port: PodCrew = {
    ...EMPTY_CREW,
    spawn: async (args) => {
      calls.push({ method: 'spawn', args })
      return snapshotOf({
        worktree:
          args.worktree === undefined
            ? undefined
            : { path: args.worktree.path, branch: args.worktree.branch },
      })
    },
  }
  return { port, calls }
}

export const fakeWorktrees = (args: { state?: WorktreeState } = {}) => {
  const calls: Call[] = []
  const port: PodWorktrees = {
    list: async (listArgs) => {
      calls.push({ method: 'list', args: listArgs })
      return listing
    },
    create: async (createArgs) => {
      calls.push({ method: 'create', args: createArgs })
      return {
        path: `/work/.atlas/worktrees/${createArgs.name}`,
        branch: createArgs.name,
        base: 'origin/main',
      }
    },
    inspect: async (inspectArgs) => {
      calls.push({ method: 'inspect', args: inspectArgs })
      return args.state ?? cleanState
    },
    remove: async (removeArgs) => {
      calls.push({ method: 'remove', args: removeArgs })
      return { branch: removeArgs.branch, branchDeleted: true }
    },
  }
  return { port, calls }
}

export const rig = (
  args: { worktrees?: PodWorktrees; crew?: PodCrew; events?: readonly V2Event[] } = {},
) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    crew: args.crew ?? fakeCrew().port,
    worktrees: args.worktrees ?? fakeWorktrees().port,
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
    },
    append: async () => undefined,
    events: () => args.events ?? [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

export const invoke = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
  projectDirectory?: string
  activeWorktree?: ActiveWorktree
}) => {
  const tool = crewPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.projectDirectory ?? '/work',
    activeWorktree: args.activeWorktree,
    threadId: toThreadId('t1'),
  })
}

export const inWorktree: ActiveWorktree = {
  path: '/work/.atlas/worktrees/dennis/wt',
  branch: 'dennis/wt',
  base: 'origin/main',
  adopted: false,
}
