import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import {
  AfterToolHook,
  EToolEffect,
  toCallId,
  toRunId,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken } from '../../container/injection'
import { SessionRegistryToken } from '../../container/tokens'
import { ATLAS_SESSION_DIR_ENV } from '../../execution/session-environment'
import { SessionRegistry } from '../../store/sessions/registry'
import { EditTool } from '../../tools/builtin/edit'
import { MultiEditTool } from '../../tools/builtin/multi-edit'
import { WriteTool } from '../../tools/builtin/write'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { OutsideProjectHook } from '../outside-project'
import { registerBuiltinHooks } from '../register-hooks'
import { HookChain } from '../registry'
import { ResolveProjectPathsHook } from '../resolve-project-paths'
import { threadEnvironmentFrom } from '../thread-environment'

const PROJECT = '/atlas/workspaces/project'
const SESSION = '/atlas/home/sessions/session-main'
const MAIN = toThreadId('thread-main')
const CHILD = toThreadId('thread-child')
const TEAMMATE = toThreadId('thread-teammate')
const STRANGER = toThreadId('thread-stranger')
const fixtures: string[] = []
afterEach(async () => {
  for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true })
})

const sessions = new SessionRegistry('/atlas/home')
for (const threadId of [MAIN, CHILD, TEAMMATE]) {
  sessions.registerThread({ sessionDir: SESSION, threadId })
}
sessions.registerThread({ sessionDir: '/atlas/home/sessions/session-other', threadId: STRANGER })

const run = (args: { hook: OutsideProjectHook; path: string; threadId?: ThreadId }) =>
  args.hook.run({
    call: {
      callId: toCallId('call-1'),
      name: 'write',
      effect: EToolEffect.Write,
      input: { path: args.path },
      threadId: args.threadId ?? MAIN,
    },
    projectDirectory: PROJECT,
    result: { ok: true, output: {}, modelText: 'ok' },
    signal: new AbortController().signal,
  })

const registeredHook = (args: { withRegistry: boolean }): OutsideProjectHook => {
  const container = createIsolatedContainer()
  if (args.withRegistry) container.register(SessionRegistryToken, { useValue: sessions })
  registerBuiltinHooks({ container })
  const hook = container
    .resolveAll(portToken(AfterToolHook))
    .find((hook) => hook.name === 'outside-project')
  if (!(hook instanceof OutsideProjectHook)) throw new Error('outside-project was not registered')
  return hook
}

describe('outside-project session ownership', () => {
  const hook = new OutsideProjectHook({ threadEnvironment: threadEnvironmentFrom({ sessions }) })

  it('stays silent for scratch, context and thread files for every registered session thread', async () => {
    for (const threadId of [MAIN, CHILD, TEAMMATE]) {
      for (const suffix of [
        'scratch/probe.mjs',
        'context/plan.md',
        `threads/${threadId}/notes.md`,
      ]) {
        expect(await run({ hook, threadId, path: `${SESSION}/${suffix}` })).toEqual({})
      }
    }
  })

  it('still warns for another session and a sibling project', async () => {
    for (const path of [
      '/atlas/home/sessions/session-other/scratch/probe.mjs',
      '/atlas/workspaces/other/file.ts',
    ]) {
      expect((await run({ hook, path })).additionalContext).toContain(path)
    }
  })

  it('uses the caller ownership instead of a shared process directory', async () => {
    const old = process.env[ATLAS_SESSION_DIR_ENV]
    process.env[ATLAS_SESSION_DIR_ENV] = SESSION
    try {
      expect(
        (await run({ hook, threadId: STRANGER, path: `${SESSION}/scratch/probe.mjs` }))
          .additionalContext,
      ).toContain(SESSION)
    } finally {
      if (old === undefined) delete process.env[ATLAS_SESSION_DIR_ENV]
      else process.env[ATLAS_SESSION_DIR_ENV] = old
    }
  })

  it('keeps the notice when the calling thread has no registered session', async () => {
    const unregistered = new OutsideProjectHook({ threadEnvironment: async () => undefined })
    expect(
      (await run({ hook: unregistered, path: `${SESSION}/scratch/probe.mjs` })).additionalContext,
    ).toContain(SESSION)
  })

  it('wires session ownership through the shared built-in registration', async () => {
    expect(
      await run({
        hook: registeredHook({ withRegistry: true }),
        path: `${SESSION}/scratch/probe.mjs`,
        threadId: CHILD,
      }),
    ).toEqual({})
  })

  it('keeps the notice when no session registry was provided', async () => {
    expect(
      (
        await run({
          hook: registeredHook({ withRegistry: false }),
          path: `${SESSION}/scratch/probe.mjs`,
        })
      ).additionalContext,
    ).toContain(SESSION)
  })
})

describe('file writes through the dispatch chain', () => {
  it('writes and edits real session files without injecting an outside-project notice', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'atlas-outside-project-'))
    fixtures.push(sessionDir)
    const registry = new SessionRegistry('/atlas/home')
    registry.registerThread({ sessionDir, threadId: CHILD })
    const tools = [new WriteTool(), new EditTool(), new MultiEditTool()]
    const resolvedThreads: ThreadId[] = []
    const lookup = threadEnvironmentFrom({ sessions: registry })
    const threadEnvironment = async (args: { threadId: ThreadId }) => {
      resolvedThreads.push(args.threadId)
      return lookup(args)
    }
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry(tools),
      hooks: new HookChain({
        beforeTool: [new ResolveProjectPathsHook(tools, { threadEnvironment })],
        afterTool: [new OutsideProjectHook({ threadEnvironment })],
      }),
    })
    for (const [name, input] of [
      ['write', { path: '$ATLAS_SESSION_DIR/scratch/probe.mjs', content: 'first\n' }],
      ['edit', { path: '$ATLAS_CONTEXT_DIR/plan.md', oldString: '', newString: 'plan\n' }],
      [
        'multi_edit',
        {
          path: '$ATLAS_SESSION_DIR/scratch/probe.mjs',
          edits: [{ oldString: 'first', newString: 'second' }],
        },
      ],
    ] as const) {
      const drafts = await dispatcher.dispatch({
        call: {
          callId: toCallId(`call-${name}`),
          runId: toRunId('run-1'),
          threadId: CHILD,
          name,
          input,
        },
        projectDirectory: PROJECT,
        events: [],
        signal: new AbortController().signal,
      })
      expect(drafts).toHaveLength(1)
      const result = drafts[0]
      expect(result?.type).toBe('tool-result')
      if (result?.type !== 'tool-result') throw new Error('expected tool result')
      expect(result.error).toBeUndefined()
    }
    expect(resolvedThreads).toEqual(Array.from({ length: 6 }, () => CHILD))
    expect(await readFile(join(sessionDir, 'scratch/probe.mjs'), 'utf8')).toBe('second\n')
    expect(await readFile(join(sessionDir, 'context/plan.md'), 'utf8')).toBe('plan\n')
  })
})
