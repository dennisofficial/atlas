import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_WORKTREES,
  type PeerRoster,
  type PeerSessionSummary,
  type PluginPodContext,
  type PodSessions,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

type Call = { method: string; args: unknown }

const summaryOf = (overrides: Partial<PeerSessionSummary> = {}): PeerSessionSummary => ({
  sessionId: 'p1',
  title: 'the peer',
  spawnedBy: 's1',
  archivedAt: null,
  ...overrides,
})

const fakeSessions = (
  args: { refused?: string | undefined; roster?: PeerRoster | undefined } = {},
) => {
  const calls: Call[] = []
  const port: PodSessions = {
    spawn: async (spawnArgs) => {
      calls.push({ method: 'spawn', args: spawnArgs })
      return { sessionId: 'p1', mainThreadId: 't1' }
    },
    message: async (messageArgs) => {
      calls.push({ method: 'message', args: messageArgs })
      return args.refused === undefined ? { queued: true } : { refused: args.refused }
    },
    list: async () => {
      calls.push({ method: 'list', args: {} })
      return args.roster ?? { spawner: null, peers: [] }
    },
  }
  return { port, calls }
}

const rig = (sessions: PodSessions) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    sessions,
    crew: EMPTY_CREW,
    worktrees: EMPTY_WORKTREES,
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
    events: () => [],
    call: async () => {
      throw new Error('this rig calls no daemon')
    },
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx }
}

const invoke = async (args: { ctx: PluginPodContext; name: string; input: unknown }) => {
  const tool = sessionsPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/work',
    threadId: toThreadId('t1'),
  })
}

const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

describe('the sessions pod', () => {
  it('declares its three tools and prompts a fragment, and denies a child none', () => {
    const { ctx } = rig(fakeSessions().port)
    expect(sessionsPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'spawn_session',
      'message_session',
      'list_sessions',
    ])
    expect(sessionsPod.prompts.map((fragment) => fragment.id)).toEqual(['sessions.peers'])
    expect(sessionsPod.childDeny).toBeUndefined()
  })

  it('writes with spawn and message and reads with list', () => {
    const { ctx } = rig(fakeSessions().port)
    const effects = (sessionsPod.tools?.(ctx) ?? []).map((tool) => [tool.name, tool.effect])
    expect(effects).toEqual([
      ['spawn_session', 'write'],
      ['message_session', 'write'],
      ['list_sessions', 'read'],
    ])
  })

  it('says peers are sessions in this sandbox, not sub-agents', () => {
    const { ctx } = rig(fakeSessions().port)
    for (const tool of sessionsPod.tools?.(ctx) ?? []) {
      expect(tool.description).toContain('sandbox')
      expect(tool.description).toContain('not a sub-agent')
    }
  })
})

describe('spawn_session', () => {
  it('spawns with the brief and names the peer and its thread', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'spawn_session',
      input: { title: 'trace the port', brief: 'read the port and report' },
    })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: 'trace the port', brief: 'read the port and report' } },
    ])
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({ sessionId: 'p1', mainThreadId: 't1' })
    expect(textOf(outcome)).toContain('p1')
    expect(textOf(outcome)).toContain('first message')
  })

  it('spawns without a brief when none is given', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'spawn_session', input: {} })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: undefined, brief: undefined } },
    ])
    expect(textOf(outcome)).toContain('no brief')
  })
})

describe('message_session', () => {
  it('queues a message and says so', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'message_session',
      input: { sessionId: 'p1', text: 'how is it going' },
    })
    expect(sessions.calls).toEqual([
      { method: 'message', args: { sessionId: 'p1', text: 'how is it going' } },
    ])
    expect(outcome.ok && outcome.output).toEqual({ ok: true })
    expect(textOf(outcome)).toContain('queued')
  })

  it('turns a refusal into the tool reason and keeps the message', async () => {
    const sessions = fakeSessions({ refused: 'this session has received all 20 messages' })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'message_session',
      input: { sessionId: 'p1', text: 'again' },
    })
    expect(outcome).toEqual({ ok: false, reason: 'this session has received all 20 messages' })
  })
})

describe('list_sessions', () => {
  it('names the spawner and every peer with its title and archived state', async () => {
    const sessions = fakeSessions({
      roster: {
        spawner: summaryOf({ sessionId: 's0', title: 'the main one', spawnedBy: null }),
        peers: [
          summaryOf({ sessionId: 'p1', title: 'one' }),
          summaryOf({ sessionId: 'p2', title: null, archivedAt: '2026-11-09T10:00:00.000Z' }),
        ],
      },
    })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({
      spawner: summaryOf({ sessionId: 's0', title: 'the main one', spawnedBy: null }),
      peers: [
        summaryOf({ sessionId: 'p1', title: 'one' }),
        summaryOf({ sessionId: 'p2', title: null, archivedAt: '2026-11-09T10:00:00.000Z' }),
      ],
    })
    const text = textOf(outcome)
    expect(text).toContain('spawner: s0  the main one  open')
    expect(text).toContain('- p1  one  open')
    expect(text).toContain('- p2  untitled  archived 2026-11-09T10:00:00.000Z')
  })

  it('says so when this session has spawned no peers', async () => {
    const { ctx } = rig(fakeSessions().port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(textOf(outcome)).toBe('You have spawned no peer sessions.')
  })
})
