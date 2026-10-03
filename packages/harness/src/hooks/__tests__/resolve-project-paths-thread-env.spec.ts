import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  BeforeToolHook,
  EBeforeToolDecision,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type ThreadId,
  type ToolCall,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken } from '../../container/injection'
import { SessionRegistryToken, WorkspaceRoot } from '../../container/tokens'
import { ATLAS_SESSION_DIR_ENV, ATLAS_THREAD_DIR_ENV } from '../../execution/session-environment'
import { sessionDirectory, threadDataDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { BashTool } from '../../tools/builtin/bash'
import { ReadTool } from '../../tools/builtin/read'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { HookChain } from '../registry'
import { closeRegistries, localShellAdapter, openRegistry } from '../../shells/__tests__/shell-registry-fixture'
import { registerBuiltinHooks } from '../register-hooks'
import { ResolveProjectPathsHook } from '../resolve-project-paths'
import { ATLAS_SHELL_DIR_ENV, threadEnvironmentFrom } from '../thread-environment'

const MAIN = toThreadId('thread-main')
const CHILD = toThreadId('thread-child')
const TEAMMATE = toThreadId('thread-teammate')
const STRANGER = toThreadId('thread-stranger')

const ROOT = '/Users/dev/project'
const RESERVED = [ATLAS_SESSION_DIR_ENV, ATLAS_THREAD_DIR_ENV, ATLAS_SHELL_DIR_ENV]

let home = ''
let sessionDir = ''
let registry: SessionRegistry
const saved = new Map<string, string | undefined>()

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'atlas-thread-env-'))
  sessionDir = sessionDirectory({ home, sessionId: MAIN })
  registry = new SessionRegistry(home)
  for (const threadId of [MAIN, CHILD, TEAMMATE]) registry.registerThread({ sessionDir, threadId })
  for (const key of RESERVED) saved.set(key, process.env[key])
})

afterEach(async () => {
  for (const key of RESERVED) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await closeRegistries()
  rmSync(home, { recursive: true, force: true })
})

const threadDirOf = (threadId: ThreadId): string => threadDataDirectory({ sessionDir, threadId })

const hookWith = (tools: ConstructorParameters<typeof ResolveProjectPathsHook>[0] = [new ReadTool()]) =>
  new ResolveProjectPathsHook(tools, { threadEnvironment: threadEnvironmentFrom({ sessions: registry }) })

const callOf = ({ name, input, threadId }: { name: string; input: unknown; threadId: ThreadId }): ToolCall => ({
  callId: toCallId('call-1'),
  name,
  input,
  effect: name === 'read' ? EToolEffect.Read : EToolEffect.Destructive,
  threadId,
})

const runOn = (args: { hook: ResolveProjectPathsHook; call: ToolCall }) =>
  args.hook.run({
    call: args.call,
    projectDirectory: ROOT,
    events: [],
    signal: new AbortController().signal,
  })

const readingAs = (path: string, threadId: ThreadId): ToolCall =>
  callOf({ name: 'read', input: { path }, threadId })

describe('per-thread session directory expansion in file tool paths', () => {
  it('expands ATLAS_THREAD_DIR to the calling thread own directory and ATLAS_SESSION_DIR to the shared one', async () => {
    const hook = hookWith()
    const thread = await runOn({ hook, call: readingAs('$ATLAS_THREAD_DIR/foo', CHILD) })
    const session = await runOn({ hook, call: readingAs('${ATLAS_SESSION_DIR}/meta.json', CHILD) })

    expect(thread).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { path: `${threadDirOf(CHILD)}/foo` },
    })
    expect(session).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { path: `${sessionDir}/meta.json` },
    })
  })

  it('keeps main, sub-agent and teammate isolated when their calls resolve concurrently', async () => {
    const hook = hookWith()
    const threads = [MAIN, CHILD, TEAMMATE, MAIN, CHILD, TEAMMATE]

    const outcomes = await Promise.all(
      threads.map((threadId) => runOn({ hook, call: readingAs('$ATLAS_THREAD_DIR/notes.md', threadId) })),
    )

    expect(outcomes.map((outcome) => (outcome.decision === EBeforeToolDecision.Allow ? outcome.input : null))).toEqual(
      threads.map((threadId) => ({ path: `${threadDirOf(threadId)}/notes.md` })),
    )
    expect(process.env[ATLAS_THREAD_DIR_ENV]).toBe(saved.get(ATLAS_THREAD_DIR_ENV))
  })

  it('merges the reserved values over the rest of the environment without mutating process.env', async () => {
    process.env['ATLAS_SPEC_OTHER'] = '/var/spec'
    try {
      const outcome = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_SPEC_OTHER/$ATLAS_THREAD_DIR/x', MAIN) })
      expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
      expect(process.env[ATLAS_SESSION_DIR_ENV]).toBe(saved.get(ATLAS_SESSION_DIR_ENV))
    } finally {
      delete process.env['ATLAS_SPEC_OTHER']
    }
  })

  it('ignores a value the caller planted in the process environment', async () => {
    process.env[ATLAS_THREAD_DIR_ENV] = '/tmp/spoofed'
    process.env[ATLAS_SESSION_DIR_ENV] = '/tmp/spoofed-session'

    const outcome = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_THREAD_DIR/foo', MAIN) })
    const unregistered = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_THREAD_DIR/foo', STRANGER) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: `${threadDirOf(MAIN)}/foo` } })
    expect(unregistered.decision).toBe(EBeforeToolDecision.Deny)
  })

  it('denies with an explicit reason when the thread belongs to no session', async () => {
    const outcome = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_THREAD_DIR/foo', STRANGER) })

    if (outcome.decision !== EBeforeToolDecision.Deny) throw new Error('expected a denial')
    expect(outcome.reason).toContain('$ATLAS_THREAD_DIR/foo')
    expect(outcome.reason).toContain('thread-stranger is not registered in any session')
  })

  it('denies with an explicit reason when the lookup itself fails', async () => {
    const hook = new ResolveProjectPathsHook([new ReadTool()], {
      threadEnvironment: async () => {
        throw new Error('disk gone')
      },
    })

    const outcome = await runOn({ hook, call: readingAs('$ATLAS_THREAD_DIR/foo', MAIN) })

    if (outcome.decision !== EBeforeToolDecision.Deny) throw new Error('expected a denial')
    expect(outcome.reason).toContain('could not be looked up: disk gone')
  })

  it('does no lookup for paths that do not reference a session variable', async () => {
    let lookups = 0
    const hook = new ResolveProjectPathsHook([new ReadTool(), new BashTool(openRegistry({ adapter: localShellAdapter }).registry)], {
      threadEnvironment: async () => {
        lookups += 1
        return undefined
      },
    })

    await runOn({ hook, call: readingAs('src/main.ts', MAIN) })
    await runOn({ hook, call: readingAs('/etc/hosts', MAIN) })
    await runOn({ hook, call: readingAs('~/notes.md', MAIN) })
    await runOn({ hook, call: callOf({ name: 'bash', input: { command: 'echo $ATLAS_THREAD_DIR' }, threadId: MAIN }) })

    expect(lookups).toBe(0)
  })

  it('expands a bash workdir but leaves the command text to the shell', async () => {
    const bash = new BashTool(openRegistry({ adapter: localShellAdapter }).registry)
    const input = { command: 'ls $ATLAS_THREAD_DIR', workdir: '$ATLAS_THREAD_DIR/work' }

    const outcome = await runOn({ hook: hookWith([bash]), call: callOf({ name: 'bash', input, threadId: CHILD }) })

    expect(outcome).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { command: 'ls $ATLAS_THREAD_DIR', workdir: `${threadDirOf(CHILD)}/work` },
    })
  })

  it('never expands ATLAS_SHELL_DIR for a file tool, even when the process environment has it', async () => {
    process.env[ATLAS_SHELL_DIR_ENV] = '/tmp/some-shell'

    const outcome = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_SHELL_DIR/spool.out', MAIN) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: '$ATLAS_SHELL_DIR/spool.out' } })
  })

  it('leaves a path through an unset variable alone so the tool still refuses it', async () => {
    const outcome = await runOn({ hook: hookWith(), call: readingAs('$ATLAS_SPEC_UNSET/x', MAIN) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: '$ATLAS_SPEC_UNSET/x' } })
  })

  it('keeps the global environment when no resolver is supplied', async () => {
    process.env[ATLAS_THREAD_DIR_ENV] = '/tmp/global-thread'
    const outcome = await runOn({ hook: new ResolveProjectPathsHook([new ReadTool()]), call: readingAs('$ATLAS_THREAD_DIR/f', MAIN) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: '/tmp/global-thread/f' } })
  })
})

describe('dispatching a file tool through the hook chain', () => {
  const dispatch = async (args: { path: string; threadId: ThreadId }): Promise<string> => {
    const hook = hookWith()
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([new ReadTool()]),
      hooks: new HookChain({ beforeTool: [hook] }),
    })
    const drafts = await dispatcher.dispatch({
      call: {
        callId: toCallId('call-1'),
        name: 'read',
        input: { path: args.path },
        runId: toRunId('run-1'),
        threadId: args.threadId,
      },
      signal: new AbortController().signal,
      projectDirectory: ROOT,
      events: [],
    })
    const draft = drafts.find((candidate) => candidate.type === 'tool-result' || candidate.type === 'tool-denied')
    if (draft?.type === 'tool-result') return draft.error?.message ?? draft.modelText ?? ''
    if (draft?.type === 'tool-denied') return `denied: ${draft.reason}`
    return ''
  }

  const plant = (threadId: ThreadId, content: string): void => {
    mkdirSync(threadDirOf(threadId), { recursive: true })
    writeFileSync(join(threadDirOf(threadId), 'foo'), content)
  }

  it('reads the calling thread file through $ATLAS_THREAD_DIR', async () => {
    plant(CHILD, 'child secret\n')
    plant(TEAMMATE, 'teammate secret\n')

    expect(await dispatch({ path: '$ATLAS_THREAD_DIR/foo', threadId: CHILD })).toContain('child secret')
    expect(await dispatch({ path: '$ATLAS_THREAD_DIR/foo', threadId: TEAMMATE })).toContain('teammate secret')
  })

  it('reports the denial for an unregistered thread instead of reading anything', async () => {
    expect(await dispatch({ path: '$ATLAS_THREAD_DIR/foo', threadId: STRANGER })).toContain('denied:')
  })

  it('still reaches the tool refusal for an unset variable', async () => {
    expect(await dispatch({ path: '$ATLAS_SPEC_UNSET/foo', threadId: CHILD })).toContain('not set in the agent')
  })

  it('leaves a directly invoked file tool on the global environment', async () => {
    process.env[ATLAS_THREAD_DIR_ENV] = threadDirOf(MAIN)
    plant(MAIN, 'direct\n')

    const outcome = await new ReadTool().invoke({
      input: { path: '$ATLAS_THREAD_DIR/foo' },
      signal: new AbortController().signal,
      idempotencyKey: 'direct',
      projectDirectory: ROOT,
      threadId: CHILD,
    })

    expect(outcome.ok && outcome.modelText).toContain('direct')
  })
})

describe('registering the hook', () => {
  const resolved = (args: { withRegistry: boolean }): ResolveProjectPathsHook => {
    const container = createIsolatedContainer()
    container.register(portToken(ToolDefinition), { useValue: new ReadTool() })
    container.register(WorkspaceRoot, { useValue: ROOT })
    if (args.withRegistry) container.register(SessionRegistryToken, { useValue: registry })
    registerBuiltinHooks({ container })
    const hook = container
      .resolveAll(portToken(BeforeToolHook))
      .find((candidate) => candidate.name === 'resolveProjectPaths')
    if (!(hook instanceof ResolveProjectPathsHook)) throw new Error('resolveProjectPaths was not registered')
    return hook
  }

  it('wires the shared session registry so registered threads resolve per thread', async () => {
    const outcome = await runOn({ hook: resolved({ withRegistry: true }), call: readingAs('$ATLAS_THREAD_DIR/foo', TEAMMATE) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: `${threadDirOf(TEAMMATE)}/foo` } })
  })

  it('falls back to the global environment when the container has no session registry', async () => {
    process.env[ATLAS_THREAD_DIR_ENV] = '/tmp/global-thread'
    const outcome = await runOn({ hook: resolved({ withRegistry: false }), call: readingAs('$ATLAS_THREAD_DIR/foo', TEAMMATE) })

    expect(outcome).toEqual({ decision: EBeforeToolDecision.Allow, input: { path: '/tmp/global-thread/foo' } })
  })
})
