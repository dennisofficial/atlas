import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EBeforeToolDecision,
  EToolEffect,
  ProcessPort,
  toCallId,
  toThreadId,
  type ProcessHandle,
  type SpawnCommand,
  type ToolCall,
} from '@dltech/atlas-core'

import { ResolveProjectPathsHook } from '../../hooks/resolve-project-paths'
import { threadEnvironmentFrom } from '../../hooks/thread-environment'
import {
  CONTEXT_DIRECTORY_NAME,
  THREADS_DIRECTORY_NAME,
  sessionDirectory,
} from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { bashDescription } from '../../tools/builtin/bash-prose'
import { ReadTool } from '../../tools/builtin/read'
import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  SessionEnvironmentProcessPort,
  sessionDirectoriesDescription,
} from '../session-environment'

const THREAD = toThreadId('thread-agreement')
const PROJECT = '/w/project'

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

class RecordingProcesses extends ProcessPort {
  readonly spawned: SpawnCommand[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return {
      stdout: streamOf(''),
      stderr: streamOf(''),
      exited: Promise.resolve(0),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return '/bin/which'
  }
}

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-session-paths-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const sessionDir = sessionDirectory({ home, sessionId: THREAD })
  await mkdir(sessionDir, { recursive: true })
  registry.registerThread({ sessionDir, threadId: THREAD })
  const inner = new RecordingProcesses()
  const port = new SessionEnvironmentProcessPort({ inner, sessions: registry })
  return { registry, sessionDir, inner, port }
}

const envOf = (env: Record<string, string | undefined> | undefined, key: string): string => {
  const value = env?.[key]
  if (value === undefined) throw new Error(`${key} is missing from the shell environment`)
  return value
}

const reading = (path: string): ToolCall => ({
  callId: toCallId('call-1'),
  name: 'read',
  input: { path },
  effect: EToolEffect.Read,
  threadId: THREAD,
})

const resolveAs = async (args: { registry: SessionRegistry; path: string }) =>
  await new ResolveProjectPathsHook([new ReadTool()], {
    threadEnvironment: threadEnvironmentFrom({ sessions: args.registry }),
  }).run({
    call: reading(args.path),
    projectDirectory: PROJECT,
    events: [],
    signal: new AbortController().signal,
  })

describe('the session paths one source of truth', () => {
  it('gives a shell and a file tool the same session directories for the same thread', async () => {
    const { registry, inner, port } = await fixture()

    await port.spawn({ cmd: ['env'], cwd: '/', env: {}, threadId: THREAD }).exited
    const shellEnv = inner.spawned[0]?.env
    const toolEnv = await threadEnvironmentFrom({ sessions: registry })({ threadId: THREAD })

    expect(toolEnv).toEqual({
      [ATLAS_SESSION_DIR_ENV]: envOf(shellEnv, ATLAS_SESSION_DIR_ENV),
      [ATLAS_THREAD_DIR_ENV]: envOf(shellEnv, ATLAS_THREAD_DIR_ENV),
      [ATLAS_CONTEXT_DIR_ENV]: envOf(shellEnv, ATLAS_CONTEXT_DIR_ENV),
    })
  })

  it('lays the context and thread directories out under the session directory the shell is told', async () => {
    const { inner, port } = await fixture()

    await port.spawn({ cmd: ['env'], cwd: '/', env: {}, threadId: THREAD }).exited
    const shellEnv = inner.spawned[0]?.env
    const sessionDir = envOf(shellEnv, ATLAS_SESSION_DIR_ENV)

    expect(envOf(shellEnv, ATLAS_CONTEXT_DIR_ENV)).toBe(join(sessionDir, CONTEXT_DIRECTORY_NAME))
    expect(envOf(shellEnv, ATLAS_THREAD_DIR_ENV)).toBe(
      join(sessionDir, THREADS_DIRECTORY_NAME, THREAD),
    )
  })

  it('resolves a file tool path against the directory that same shell reports', async () => {
    const { registry, inner, port } = await fixture()

    await port.spawn({ cmd: ['env'], cwd: '/', env: {}, threadId: THREAD }).exited
    const shellEnv = inner.spawned[0]?.env
    const context = await resolveAs({ registry, path: '$ATLAS_CONTEXT_DIR/plan.md' })
    const scratch = await resolveAs({ registry, path: '${ATLAS_SESSION_DIR}/scratch/notes.md' })

    expect(context).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { path: join(envOf(shellEnv, ATLAS_CONTEXT_DIR_ENV), 'plan.md') },
    })
    expect(scratch).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { path: join(envOf(shellEnv, ATLAS_SESSION_DIR_ENV), 'scratch', 'notes.md') },
    })
  })

  it('describes the variables that the shell and the tools actually use', () => {
    const description = bashDescription({ defaultTimeoutMs: 120_000, maximumTimeoutMs: 600_000 })

    expect(description).toContain(sessionDirectoriesDescription)
    expect(sessionDirectoriesDescription).toContain(
      `${ATLAS_CONTEXT_DIR_ENV} is $${ATLAS_SESSION_DIR_ENV}/${CONTEXT_DIRECTORY_NAME}`,
    )
    expect(sessionDirectoriesDescription).toContain(
      `${ATLAS_THREAD_DIR_ENV} is $${ATLAS_SESSION_DIR_ENV}/${THREADS_DIRECTORY_NAME}/<thread id>`,
    )
    expect(description).not.toContain('ATLAS_SESSION_DIR and ATLAS_CONTEXT_DIR name')
  })
})
