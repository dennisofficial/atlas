import { describe, expect, it } from 'bun:test'

import {
  ESessionStatus,
  SPAWN_FILE_MAX_BYTES,
  toThreadId,
  type PromptContext,
} from '@dltech/atlas-core'
import { ECallFailure, ECallStatus } from '@dltech/atlas-protocol'
import {
  EMPTY_MESSAGES,
  type PluginPodContext,
  type PodMessages,
  type PodSessions,
  type SessionBrief,
  EMPTY_CREW,
  EMPTY_ANALYTICS,
  EMPTY_CLASSIFIER,
  EMPTY_MCP_CONTROL,
  EMPTY_ROUTINES,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  EMPTY_POD_RESOURCES,
  UNVERSIONED_SETTINGS,
} from '@dltech/atlas-plugin-sdk'

import { sessionsPod } from '..'

type Call = { method: string; args: unknown }

const CONTEXT_DIRECTORY = '/atlas/home/sessions/s1/context'

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
  args: {
    briefs?: readonly SessionBrief[] | undefined
    teammateBriefs?: readonly SessionBrief[] | undefined
  } = {},
) => {
  const calls: Call[] = []
  const port: PodSessions = {
    spawn: async (spawnArgs) => {
      calls.push({ method: 'spawn', args: spawnArgs })
      return { sessionId: 'p1', mainThreadId: 't1' }
    },
    list: async () => {
      calls.push({ method: 'list', args: {} })
      return args.briefs ?? []
    },
    archive: async (archiveArgs) => {
      calls.push({ method: 'archive', args: archiveArgs })
      return { archived: true, already: false }
    },
    teammates: async () => {
      calls.push({ method: 'teammates', args: {} })
      return args.teammateBriefs ?? []
    },
  }
  return { port, calls }
}

const rig = (
  sessions: PodSessions,
  messages: PodMessages = EMPTY_MESSAGES,
  files: Readonly<Record<string, string>> | undefined = undefined,
  daemon: { notUtf8?: readonly string[] } = {},
) => {
  const ctx: PluginPodContext = {
    sessionId: 's1',
    sessions,
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages,
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
      gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
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
    call: async (op) => {
      const path = 'path' in op ? op.path : ''
      const text = files?.[path]
      if (text !== undefined && op.op === 'stat') {
        return {
          status: ECallStatus.Ok,
          op: 'stat',
          value: { size: text.length, mode: 0o644, mtimeMs: 0, isFile: true, isDirectory: false },
        }
      }
      if (text !== undefined && op.op === 'readTextForEdit') {
        const broken = daemon.notUtf8?.includes(path) === true
        return {
          status: ECallStatus.Ok,
          op: 'readTextForEdit',
          value: { text, strict: broken ? null : text },
        }
      }
      if (text !== undefined && op.op === 'readFile') {
        return { status: ECallStatus.Ok, op: 'readFile', value: text }
      }
      return {
        status: ECallStatus.Failed,
        op: op.op,
        error: {
          code: ECallFailure.NotFound,
          message: `no file at ${path}`,
        },
      }
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
  it('declares its six tools and prompts a fragment, and denies a child none', () => {
    const { ctx } = rig(fakeSessions().port)
    expect(sessionsPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'send_message',
      'archive_session',
      'spawn_session',
      'spawn_teammate',
      'list_sessions',
      'list_teammates',
    ])
    expect(sessionsPod.prompts.map((fragment) => fragment.id)).toEqual(['sessions.peers'])
    expect(sessionsPod.childDeny).toBeUndefined()
  })

  it('writes with send and spawn and reads with list', () => {
    const { ctx } = rig(fakeSessions().port)
    const effects = (sessionsPod.tools?.(ctx) ?? []).map((tool) => [tool.name, tool.effect])
    expect(effects).toEqual([
      ['send_message', 'write'],
      ['archive_session', 'write'],
      ['spawn_session', 'write'],
      ['spawn_teammate', 'write'],
      ['list_sessions', 'read'],
      ['list_teammates', 'read'],
    ])
  })

  it('describes every session as the operator’s own, with no lead or peer and no shared pod', () => {
    const { ctx } = rig(fakeSessions().port)
    for (const tool of sessionsPod.tools?.(ctx) ?? []) {
      if (tool.name === 'send_message') continue
      expect(tool.description).not.toContain('peer')
      expect(tool.description).not.toContain('sub-agent')
      expect(tool.description).not.toContain('intoPod')
      expect(tool.description).not.toContain('shares your sandbox')
    }
    const text = sessionsPod.prompts[0]?.text(promptCtx) ?? ''
    expect(text).not.toContain('peer')
    expect(text).toContain('spawn_teammate')
    expect(text).toContain('provenance')
    expect(text).toContain('own sandbox')
  })

  it('names the session that created this one in the fragment', () => {
    const text = sessionsPod.prompts[0]?.text({
      ...promptCtx,
      spawner: { sessionId: 's0', title: 'the parser' },
    })
    expect(text).toContain('s0 (the parser) created this one')
    expect(text).toContain('not its owner')
    expect(text).toContain('Report the outcome to the operator in your own thread')
    expect(text).toContain('only when the brief asks for a reply')
  })

  it('does not make every spawned session report back', () => {
    const text = sessionsPod.prompts[0]?.text(promptCtx) ?? ''
    expect(text).not.toContain('It reports the URL back')
    expect(text).toContain('reports back only when its brief asks')
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
        args: { title: 'trace the port', brief: 'read the port and report', nested: false },
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
      { method: 'spawn', args: { title: undefined, brief: undefined, nested: false } },
    ])
    expect(textOf(outcome)).toContain('no brief')
    expect(textOf(outcome)).not.toContain('teammate')
  })

  it('reports files with no brief as started, not waiting', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/plan.md`]: 'the plan',
    })
    const outcome = await invoke({ ctx, name: 'spawn_session', input: { files: ['plan.md'] } })
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).toContain('plan.md')
    expect(textOf(outcome)).toContain('first message')
    expect(textOf(outcome)).not.toContain('waits for a message')
  })

  it('refuses to place a top-level session under the caller', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'spawn_session', input: { nested: true } })
    expect(outcome.ok).toBe(false)
    expect(sessions.calls).toEqual([])
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

describe('spawn_teammate', () => {
  it('spawns a nested session by default and names it as a teammate', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { title: 'the parser', brief: 'take the parser and report' },
    })
    expect(sessions.calls).toEqual([
      {
        method: 'spawn',
        args: { title: 'the parser', brief: 'take the parser and report', nested: true },
      },
    ])
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.output).toEqual({ sessionId: 'p1', mainThreadId: 't1' })
    expect(textOf(outcome)).toContain('teammate')
    expect(textOf(outcome)).toContain('first message')
  })

  it('spawns a teammate without a brief when none is given', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'spawn_teammate', input: {} })
    expect(sessions.calls).toEqual([
      { method: 'spawn', args: { title: undefined, brief: undefined, nested: true } },
    ])
    expect(textOf(outcome)).toContain('no brief')
  })

  it('reads the attached files under the context folder and spawns with them', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/plan.md`]: 'the plan',
      [`${CONTEXT_DIRECTORY}/sections/03-auth.md`]: 'the auth section',
    })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { brief: 'do the work', files: ['plan.md', 'sections/03-auth.md'] },
    })
    expect(sessions.calls).toEqual([
      {
        method: 'spawn',
        args: {
          title: undefined,
          brief: 'do the work',
          nested: true,
          files: [
            { path: 'plan.md', text: 'the plan' },
            { path: 'sections/03-auth.md', text: 'the auth section' },
          ],
        },
      },
    ])
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).toContain('plan.md, sections/03-auth.md')
  })

  it('refuses a file path that climbs out of the context folder, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      '/atlas/home/sessions/s1/x.md': 'the sibling',
    })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { brief: 'do the work', files: ['../x.md'] },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('../x.md')
    expect(sessions.calls).toEqual([])
  })

  it('refuses an absolute file path, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, { '/etc/hosts': 'local host' })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { files: ['/etc/hosts'] },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('/etc/hosts')
    expect(sessions.calls).toEqual([])
  })

  it('refuses a file it cannot read, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/plan.md`]: 'the plan',
    })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { files: ['plan.md', 'missing.md'] },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('could not read missing.md')
    expect(sessions.calls).toEqual([])
  })

  it('refuses files over the size cap, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/big.md`]: 'x'.repeat(SPAWN_FILE_MAX_BYTES + 1),
    })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { files: ['big.md'] },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('big.md')
    expect(sessions.calls).toEqual([])
  })

  it('attaches a file behind a linked folder by the content it reads', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/specs/auth.md`]: 'the linked spec',
    })
    const outcome = await invoke({
      ctx,
      name: 'spawn_teammate',
      input: { files: ['specs/auth.md'] },
    })
    expect(outcome.ok).toBe(true)
    expect(sessions.calls[0]?.args).toMatchObject({
      files: [{ path: 'specs/auth.md', text: 'the linked spec' }],
    })
  })

  it('refuses a file that is not UTF-8 text, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(
      sessions.port,
      EMPTY_MESSAGES,
      { [`${CONTEXT_DIRECTORY}/bad.md`]: 'caf\uFFFD' },
      { notUtf8: [`${CONTEXT_DIRECTORY}/bad.md`] },
    )
    const outcome = await invoke({ ctx, name: 'spawn_teammate', input: { files: ['bad.md'] } })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('not UTF-8 text')
    expect(sessions.calls).toEqual([])
  })

  it('refuses a binary file holding a NUL byte, and spawns nothing', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/binary.md`]: 'ab\u0000cd',
    })
    const outcome = await invoke({ ctx, name: 'spawn_teammate', input: { files: ['binary.md'] } })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('NUL')
    expect(sessions.calls).toEqual([])
  })

  it('reports files with no brief as started, not waiting', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port, EMPTY_MESSAGES, {
      [`${CONTEXT_DIRECTORY}/plan.md`]: 'the plan',
    })
    const outcome = await invoke({ ctx, name: 'spawn_teammate', input: { files: ['plan.md'] } })
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).toContain('plan.md')
    expect(textOf(outcome)).toContain('first message')
    expect(textOf(outcome)).not.toContain('waits for a message')
  })
})

describe('list_teammates', () => {
  it('lists only the caller’s nested teammates with their status', async () => {
    const teammates = [
      briefOf({ sessionId: 'p1', title: 'one', status: { state: ESessionStatus.Thinking } }),
      briefOf({
        sessionId: 'p2',
        title: null,
        archivedAt: '2026-11-09T10:00:00.000Z',
        status: { state: ESessionStatus.Idle },
      }),
    ]
    const sessions = fakeSessions({ teammateBriefs: teammates })
    const { ctx } = rig(sessions.port)
    const outcome = await invoke({ ctx, name: 'list_teammates', input: {} })
    expect(sessions.calls).toEqual([{ method: 'teammates', args: {} }])
    expect(outcome.ok && outcome.output).toEqual({ teammates })
    const text = textOf(outcome)
    expect(text).toContain('p1  one  working')
    expect(text).toContain('p2  untitled  archived 2026-11-09T10:00:00.000Z')
    expect(text).not.toContain('current')
  })

  it('says so when the caller has no teammates', async () => {
    const sessions = fakeSessions()
    const { ctx } = rig(sessions.port)
    expect(textOf(await invoke({ ctx, name: 'list_teammates', input: {} }))).toBe(
      'This session has no teammates.',
    )
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
