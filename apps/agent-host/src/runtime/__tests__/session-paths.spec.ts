import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { toThreadId, type ProcessPort, type SpawnCommand } from '@dltech/atlas-core'

import { BashTool } from '../../agent-tools/bash'
import { bashDescription } from '../../agent-tools/bash-prose'
import { expandPathEnvironment, pathEnvironmentNote } from '../../agent-tools/file-text'
import { ReadTool } from '../../agent-tools/read'
import { files, processes } from '../../agent-tools/__tests__/support'
import { ForegroundOnlyShells } from '../foreground-shells'
import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  pathEnvironmentOf,
  sessionEnvironmentOf,
  sessionPathsOf,
  shellEnvironmentOf,
  type SessionPaths,
} from '../session-paths'

const sessionId = 'session-1'
const threadId = toThreadId('thread-1')

const homeIn = (name: string): Promise<string> => mkdtemp(join(tmpdir(), `atlas-${name}-`))

const spawnedEnvOf = async (args: {
  paths: SessionPaths
  base: Record<string, string>
}): Promise<Record<string, string | undefined>> => {
  const env = shellEnvironmentOf(args)
  const spawned: SpawnCommand[] = []
  const recording: ProcessPort = {
    spawn: (command) => {
      spawned.push(command)
      return processes.spawn(command)
    },
    which: (command) => processes.which(command),
  } as ProcessPort
  const tool = new BashTool(new ForegroundOnlyShells(), files, recording, () => env)
  await tool.invoke({
    input: { description: 'Print a word', command: 'echo hi' },
    signal: new AbortController().signal,
    idempotencyKey: 'session-paths',
    projectDirectory: args.paths.sessionDir,
    threadId,
  })
  return spawned[0]?.env ?? {}
}

describe('the session paths of a thread', () => {
  it('puts the session, its context and images and the thread inside the Atlas home', async () => {
    const home = await homeIn('session-paths-layout')
    const paths = sessionPathsOf({ sessionId, threadId, home })

    expect(paths.sessionDir).toBe(join(home, 'sessions', sessionId))
    expect(paths.threadDir).toBe(join(paths.sessionDir, 'threads', threadId))
    expect(paths.contextDir).toBe(join(paths.sessionDir, 'context'))
    expect(paths.imagesDir).toBe(join(paths.sessionDir, 'images'))
  })

  it('shares the session and context directories between two threads and splits the thread ones', async () => {
    const home = await homeIn('session-paths-threads')
    const first = sessionPathsOf({ sessionId, threadId, home })
    const second = sessionPathsOf({ sessionId, threadId: toThreadId('thread-2'), home })

    expect(sessionEnvironmentOf(first)[ATLAS_SESSION_DIR_ENV]).toBe(
      sessionEnvironmentOf(second)[ATLAS_SESSION_DIR_ENV],
    )
    expect(sessionEnvironmentOf(first)[ATLAS_CONTEXT_DIR_ENV]).toBe(
      sessionEnvironmentOf(second)[ATLAS_CONTEXT_DIR_ENV],
    )
    expect(sessionEnvironmentOf(first)[ATLAS_THREAD_DIR_ENV]).not.toBe(
      sessionEnvironmentOf(second)[ATLAS_THREAD_DIR_ENV],
    )
    expect(first.threadDir).not.toBe(second.threadDir)
  })
})

describe('the env a shell of that thread receives', () => {
  it('expands through the file tools to exactly the directories the resolver computed', async () => {
    const home = await homeIn('session-paths-shell')
    const paths = sessionPathsOf({ sessionId, threadId, home })
    const env = await spawnedEnvOf({ paths, base: { GH_TOKEN: 'gho_abc' } })

    expect(env['GH_TOKEN']).toBe('gho_abc')
    for (const [name, directory] of Object.entries(sessionEnvironmentOf(paths))) {
      expect(expandPathEnvironment({ path: `$${name}`, env })).toEqual({
        ok: true,
        path: directory,
      })
    }
    expect(expandPathEnvironment({ path: '$ATLAS_HOME', env })).toEqual({ ok: true, path: home })
  })

  it('reads a file addressed through a session variable', async () => {
    const home = await homeIn('session-paths-read')
    const paths = sessionPathsOf({ sessionId, threadId, home })
    await mkdir(paths.contextDir, { recursive: true })
    await writeFile(join(paths.contextDir, 'plan.md'), 'the context plan\n')

    const read = await new ReadTool({ files, pathEnv: pathEnvironmentOf(paths) }).invoke({
      input: { path: `$${ATLAS_CONTEXT_DIR_ENV}/plan.md` },
      signal: new AbortController().signal,
      idempotencyKey: 'session-paths-read',
      projectDirectory: paths.sessionDir,
      threadId,
    })

    if (!read.ok) throw new Error(read.reason)
    expect(read.modelText).toContain('the context plan')
  })

  it('refuses the same path for a file tool built without the session env', async () => {
    const home = await homeIn('session-paths-unset')
    const paths = sessionPathsOf({ sessionId, threadId, home })

    const read = await new ReadTool({ files }).invoke({
      input: { path: `$${ATLAS_CONTEXT_DIR_ENV}/plan.md` },
      signal: new AbortController().signal,
      idempotencyKey: 'session-paths-unset',
      projectDirectory: paths.sessionDir,
      threadId,
    })

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toContain(`$${ATLAS_CONTEXT_DIR_ENV}`)
  })
})

describe('the description the prompt carries', () => {
  it('names exactly the variables the file tools expand', async () => {
    const paths = sessionPathsOf({ sessionId, threadId, home: '/atlas/home' })
    const named = [...new Set(pathEnvironmentNote.match(/ATLAS_[A-Z_]+/g) ?? [])].sort()

    expect(named).toEqual(Object.keys(pathEnvironmentOf(paths)).sort())
  })

  it('names the session variables in the bash prose too', () => {
    const description = bashDescription({ defaultTimeoutMs: 120_000, maximumTimeoutMs: 600_000 })

    for (const name of [ATLAS_SESSION_DIR_ENV, ATLAS_THREAD_DIR_ENV, ATLAS_CONTEXT_DIR_ENV]) {
      expect(description).toContain(name)
    }
  })
})
