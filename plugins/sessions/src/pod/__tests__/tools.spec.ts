import { describe, expect, it } from 'bun:test'

import { toThreadId, type PromptContext } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodSessions,
  type SessionBrief,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

type Call = { method: string; args: unknown }

const promptCtx: PromptContext = {
  groups: [],
  provider: { id: 'anthropic', modelId: 'claude-sonnet-4-5' },
  model: { contextWindow: 200_000 },
  projectDirectory: '/work',
}

const briefOf = (overrides: Partial<SessionBrief> = {}): SessionBrief => ({
  sessionId: 'p1',
  title: 'one',
  spawnedBy: 's1',
  archivedAt: null,
  current: false,
  ...overrides,
})

const fakeSessions = (
  args: { refused?: string | undefined; briefs?: readonly SessionBrief[] | undefined } = {},
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
      return args.briefs ?? []
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
    live: () => undefined,
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

  it('describes every session as the operator’s own, with no lead or peer', () => {
    const { ctx } = rig(fakeSessions().port)
    for (const tool of sessionsPod.tools?.(ctx) ?? []) {
      expect(tool.description).toContain('operator')
      expect(tool.description).not.toContain('peer')
      expect(tool.description).not.toContain('sub-agent')
    }
    const text = sessionsPod.prompts[0]?.text(promptCtx) ?? ''
    expect(text).not.toContain('peer')
    expect(text).toContain('teammate')
    expect(text).toContain('provenance')
  })
})

describe('spawn_session', () => {
  it('spawns with the brief and names the session and its thread', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'spawn_session',
      input: { title: 'trace the port', brief: 'read the port and report' },
    })
    expect(sessions.calls).toEqual([
      {
        method: 'spawn',
        args: { title: 'trace the port', brief: 'read the port and report', intoPod: undefined },
      },
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
      { method: 'spawn', args: { title: undefined, brief: undefined, intoPod: undefined } },
    ])
    expect(textOf(outcome)).toContain('no brief')
    expect(textOf(outcome)).not.toContain('teammate')
  })

  it('asks for a teammate in the calling sandbox when intoPod is true', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'spawn_session',
      input: { brief: 'pair with me', intoPod: true },
    })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: undefined, brief: 'pair with me', intoPod: true } },
    ])
    expect(textOf(outcome)).toBe(
      'Started teammate p1 in your sandbox; your brief is its first message.',
    )
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
  it('lists every session with its title, archived state and the current one marked', async () => {
    const briefs = [
      briefOf({ sessionId: 's0', title: 'the main one', spawnedBy: null, current: true }),
      briefOf({ sessionId: 'p1', title: 'one' }),
      briefOf({ sessionId: 'p2', title: null, archivedAt: '2026-11-09T10:00:00.000Z' }),
    ]
    const sessions = fakeSessions({ briefs })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({ sessions: briefs })
    const text = textOf(outcome)
    expect(text).toContain('s0  the main one  open  current')
    expect(text).toContain('p1  one  open')
    expect(text).toContain('p2  untitled  archived 2026-11-09T10:00:00.000Z')
    expect(text).not.toContain('p1  one  open  current')
  })

  it('says so when the operator has no sessions', async () => {
    const { ctx } = rig(fakeSessions().port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(textOf(outcome)).toBe('The operator has no sessions.')
  })
})
