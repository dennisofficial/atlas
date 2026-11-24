import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_MESSAGES,
  EMPTY_POD_RESOURCES,
  EMPTY_ROUTINES,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  UNVERSIONED_SETTINGS,
  type PluginPodContext,
  type PodSessions,
  type SessionArchive,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

const CONTEXT_DIRECTORY = '/atlas/home/sessions/s1/context'

const fakeSessions = (
  answer: () => Promise<SessionArchive>,
): { port: PodSessions; calls: { sessionId: string }[] } => {
  const calls: { sessionId: string }[] = []
  const port: PodSessions = {
    spawn: async () => {
      throw new Error('this rig spawns no session')
    },
    list: async () => [],
    teammates: async () => [],
    archive: async (args) => {
      calls.push({ sessionId: args.sessionId })
      return answer()
    },
  }
  return { port, calls }
}

const ctxOf = (sessions: PodSessions): PluginPodContext => ({
  sessionId: 's1',
  sessions,
  resources: EMPTY_POD_RESOURCES,
  crew: EMPTY_CREW,
  messages: EMPTY_MESSAGES,
  classifier: EMPTY_CLASSIFIER,
  analytics: EMPTY_ANALYTICS,
  worktrees: EMPTY_WORKTREES,
  notify: async () => undefined,
  control: {
    settingsVersions: async () => UNVERSIONED_SETTINGS,
    exposePort: async () => {
      throw new Error('this rig exposes no port')
    },
    mcp: EMPTY_MCP_CONTROL,
    webSearch: {
      config: async () => ({ backend: undefined, key: undefined }),
    },
    routines: EMPTY_ROUTINES,
    subscriptions: EMPTY_SUBSCRIPTIONS,
    gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
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
  events: () => [],
  env: async () => ({ ATLAS_CONTEXT_DIR: CONTEXT_DIRECTORY }),
  call: async () => {
    throw new Error('this rig reaches no daemon')
  },
  live: () => undefined,
  onDaemonEvent: () => () => undefined,
  log: () => undefined,
})

const invoke = async (args: { sessions: PodSessions; input: unknown }) => {
  const tool = sessionsPod
    .tools?.(ctxOf(args.sessions))
    .find((candidate) => candidate.name === 'archive_session')
  if (tool === undefined) throw new Error('no archive_session tool')
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

describe('archive_session', () => {
  it('archives the spawned session and says where it went', async () => {
    const { port, calls } = fakeSessions(async () => ({ archived: true, already: false }))

    const outcome = await invoke({ sessions: port, input: { sessionId: 'p1' } })

    expect(calls).toEqual([{ sessionId: 'p1' }])
    expect(outcome).toEqual({
      ok: true,
      output: { sessionId: 'p1', already: false },
      modelText:
        'Archived session p1. It folds into Done in the sidebar, its pod sleeps, and the operator can unarchive it.',
    })
  })

  it('says a session that was already archived stayed archived', async () => {
    const { port } = fakeSessions(async () => ({ archived: true, already: true }))

    const outcome = await invoke({ sessions: port, input: { sessionId: 'p1' } })

    expect(outcome).toEqual({
      ok: true,
      output: { sessionId: 'p1', already: true },
      modelText: 'Session p1 was already archived.',
    })
  })

  it('returns the refusal of a session this one did not spawn', async () => {
    const { port } = fakeSessions(async () => ({
      refused: 'session p1 was not spawned by this session, so only the operator can archive it',
    }))

    const outcome = await invoke({ sessions: port, input: { sessionId: 'p1' } })

    expect(outcome).toEqual({
      ok: false,
      reason: 'session p1 was not spawned by this session, so only the operator can archive it',
    })
  })

  it('returns the message of an error the port throws', async () => {
    const { port } = fakeSessions(async () => {
      throw new Error('the control plane is unreachable')
    })

    const outcome = await invoke({ sessions: port, input: { sessionId: 'p1' } })

    expect(outcome).toEqual({ ok: false, reason: 'the control plane is unreachable' })
  })
})
