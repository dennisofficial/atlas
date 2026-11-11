import { describe, expect, it } from 'bun:test'

import { ESessionStatus, EReportKind, toThreadId, type PromptContext } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodSessions,
  type SessionBrief,
  EMPTY_MCP_CONTROL,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

type Call = { method: string; args: unknown }

const promptCtx: PromptContext = {
  groups: [],
  provider: { id: 'anthropic', modelId: 'claude-sonnet-4-5' },
  projectDirectory: '/work',
}

const briefOf = (overrides: Partial<SessionBrief> = {}): SessionBrief => ({
  sessionId: 'p1',
  title: 'one',
  spawnedBy: 's1',
  nested: true,
  archivedAt: null,
  current: false,
  status: { state: ESessionStatus.Idle },
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
    report: async (reportArgs) => {
      calls.push({ method: 'report', args: reportArgs })
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
      mcp: EMPTY_MCP_CONTROL,
      webSearch: {
        config: async () => ({ backend: undefined, key: undefined }),
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
  it('declares its four tools and prompts a fragment, and denies a child none', () => {
    const { ctx } = rig(fakeSessions().port)
    expect(sessionsPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'spawn_session',
      'message_session',
      'report_to_spawner',
      'list_sessions',
    ])
    expect(sessionsPod.prompts.map((fragment) => fragment.id)).toEqual(['sessions.peers'])
    expect(sessionsPod.childDeny).toBeUndefined()
  })

  it('writes with spawn, message and report and reads with list', () => {
    const { ctx } = rig(fakeSessions().port)
    const effects = (sessionsPod.tools?.(ctx) ?? []).map((tool) => [tool.name, tool.effect])
    expect(effects).toEqual([
      ['spawn_session', 'write'],
      ['message_session', 'write'],
      ['report_to_spawner', 'write'],
      ['list_sessions', 'read'],
    ])
  })

  it('describes every session as the operator’s own, with no lead or peer and no shared pod', () => {
    const { ctx } = rig(fakeSessions().port)
    for (const tool of sessionsPod.tools?.(ctx) ?? []) {
      expect(tool.description).not.toContain('peer')
      expect(tool.description).not.toContain('sub-agent')
      expect(tool.description).not.toContain('intoPod')
      expect(tool.description).not.toContain('shares your sandbox')
    }
    const text = sessionsPod.prompts[0]?.text(promptCtx) ?? ''
    expect(text).not.toContain('peer')
    expect(text).not.toContain('teammate')
    expect(text).toContain('provenance')
    expect(text).toContain('own sandbox')
  })

  it('names the session that created this one in the fragment', () => {
    const text = sessionsPod.prompts[0]?.text({
      ...promptCtx,
      spawner: { sessionId: 's0', title: 'the parser' },
    })
    expect(text).toContain('s0 (the parser) created this one')
    expect(text).toContain('report_to_spawner')
  })

  it('says nothing about a creator when this session has no spawner', () => {
    expect(sessionsPod.prompts[0]?.text(promptCtx) ?? '').not.toContain('created this one')
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
        args: { title: 'trace the port', brief: 'read the port and report', nested: true },
      },
    ])
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({
      sessionId: 'p1',
      mainThreadId: 't1',
    })
    expect(textOf(outcome)).toContain('p1')
    expect(textOf(outcome)).toContain('first message')
  })

  it('spawns without a brief when none is given', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'spawn_session', input: {} })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: undefined, brief: undefined, nested: true } },
    ])
    expect(textOf(outcome)).toContain('no brief')
    expect(textOf(outcome)).not.toContain('teammate')
  })

  it('spawns beside the caller when nested is false', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'spawn_session', input: { nested: false } })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: undefined, brief: undefined, nested: false } },
    ])
    expect(outcome.ok).toBe(true)
  })

  it('refuses a field that would place the session on another pod', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'spawn_session',
      input: { brief: 'pair with me', intoPod: true },
    })
    expect(outcome.ok).toBe(false)
    expect(sessions.calls).toEqual([])
  })
})

describe('report_to_spawner', () => {
  it('sends the kind and the text and says the report is with the spawner', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'report_to_spawner',
      input: { kind: EReportKind.Blocked, text: 'the parser needs a fixture' },
    })
    expect(sessions.calls).toEqual([
      {
        method: 'report',
        args: { kind: EReportKind.Blocked, text: 'the parser needs a fixture' },
      },
    ])
    expect(outcome.ok && outcome.output).toEqual({ kind: EReportKind.Blocked })
    expect(textOf(outcome)).toContain('created you')
  })

  it('turns a session with no spawner into the tool reason', async () => {
    const sessions = fakeSessions({ refused: 'this session has no spawner' })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'report_to_spawner',
      input: { kind: EReportKind.Done, text: 'all done' },
    })
    expect(outcome).toEqual({
      ok: false,
      reason: 'this session has no spawner',
    })
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
    const sessions = fakeSessions({
      refused: 'this session has received all 20 messages',
    })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'message_session',
      input: { sessionId: 'p1', text: 'again' },
    })
    expect(outcome).toEqual({
      ok: false,
      reason: 'this session has received all 20 messages',
    })
  })
})

describe('list_sessions', () => {
  it('lists every session with its title, status and the current one marked', async () => {
    const briefs = [
      briefOf({
        sessionId: 's0',
        title: 'the main one',
        spawnedBy: null,
        current: true,
      }),
      briefOf({
        sessionId: 'p1',
        title: 'one',
        status: { state: ESessionStatus.Thinking },
      }),
      briefOf({
        sessionId: 'p2',
        title: null,
        status: {
          state: ESessionStatus.Failed,
          reason: 'the sandbox did not boot',
        },
      }),
      briefOf({
        sessionId: 'p3',
        title: 'three',
        archivedAt: '2026-11-09T10:00:00.000Z',
      }),
    ]
    const sessions = fakeSessions({ briefs })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({ sessions: briefs })
    const text = textOf(outcome)
    expect(text).toContain('s0  the main one  idle  current')
    expect(text).toContain('p1  one  working')
    expect(text).toContain('p2  untitled  failed: the sandbox did not boot')
    expect(text).toContain('p3  three  archived 2026-11-09T10:00:00.000Z')
    expect(text).not.toContain('p1  one  working  current')
  })

  it('says so when the operator has no sessions', async () => {
    const { ctx } = rig(fakeSessions().port)
    const outcome = await invoke({ ctx, name: 'list_sessions', input: {} })
    expect(textOf(outcome)).toBe('The operator has no sessions.')
  })
})
