import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { buildContextArchive } from '@dltech/atlas-harness'
import { buildSessionArchive } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'
import {
  EServeEvent,
  EWorkspaceState,
  materializeTranscript,
  startServe,
  WORKSPACE_SENTINEL,
  type EnsureWorkspace,
  type FetchTranscriptArchive,
  type ServeHandle,
} from '../index'

import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'
const CONTROL_PLANE = 'https://api.example.com'

const threadId = toThreadId('thread-drive')

type Drive = { root: string; home: string; workspace: string }

const drives: Drive[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

const freshDrive = async (): Promise<Drive> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-drive-spec-'))
  const drive = { root, home: join(root, 'home'), workspace: join(root, 'workspace') }
  drives.push(drive)
  return drive
}

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const drive of drives.splice(0, drives.length)) {
    rmSync(drive.root, { recursive: true, force: true })
  }
})

const bareSpec = {
  remoteUrl: null,
  branch: null,
  commit: null,
  patch: '',
  githubToken: null,
  contextBundle: null,
}

const writeBootstrap = async (args: {
  home: string
  context: Uint8Array
  transcript: Uint8Array | null
  spec?: Record<string, unknown> | undefined
}): Promise<void> => {
  const dir = join(args.home, 'bootstrap')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'workspace-spec.json'),
    JSON.stringify({ ...bareSpec, ...args.spec }),
  )
  await writeFile(join(dir, 'context.tar.gz'), args.context)
  if (args.transcript !== null) await writeFile(join(dir, 'transcript.tar.gz'), args.transcript)
}

const withAtlasHome = (home: string): void => {
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
}

const bootOn = async (args: {
  drive: Drive
  archives: { context: Uint8Array; transcript: Uint8Array | null }
  ensureWorkspace: EnsureWorkspace
  spec?: Record<string, unknown> | undefined
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
  compose?: ((composeArgs: { model?: { ref: string; effort?: string | undefined } | undefined }) => Promise<ReturnType<typeof fakeServeApp>>) | undefined
}): Promise<{ handle: ServeHandle; lines: string[] }> => {
  const lines: string[] = []
  await writeBootstrap({
    home: args.drive.home,
    context: args.archives.context,
    transcript: args.archives.transcript,
    spec: args.spec,
  })
  const handle = await startServe({
    env: {},
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    cwd: args.drive.workspace,
    write: (line) => lines.push(line),
    compose: args.compose ?? (async () => fakeServeApp({ threadId, root: args.drive.workspace })),
    ensureWorkspace: args.ensureWorkspace,
    fetchTranscriptArchive: args.fetchTranscriptArchive,
  })
  running.push(handle)
  return { handle, lines }
}

const transcriptArchiveFrom = async (
  source: string,
  threadMeta?: Record<string, unknown>,
): Promise<Uint8Array> => {
  const sourceSession = sessionDirectory({ home: source, sessionId: threadId })
  await mkdir(join(sourceSession, 'threads'), { recursive: true })
  await writeFile(join(sourceSession, 'meta.json'), '{"format":1}')
  await writeFile(join(sourceSession, 'threads', `${threadId}.events.jsonl`), '')
  if (threadMeta !== undefined) {
    await writeFile(
      join(sourceSession, 'threads', `${threadId}.meta.json`),
      JSON.stringify(threadMeta),
    )
  }
  const archive = await buildSessionArchive({ sessionDir: sourceSession })
  if (archive === undefined) throw new Error('expected a transcript archive')
  return archive
}

const contextArchiveFrom = async (source: string): Promise<Uint8Array> => {
  const instructions = join(source, 'ATLAS.md')
  await writeFile(instructions, '# global instructions')
  const archive = await buildContextArchive({
    files: [{ key: '.atlas/ATLAS.md', path: instructions }],
  })
  if (archive === undefined) throw new Error('expected a context archive')
  return archive
}

const freshArchives = async (): Promise<{
  source: string
  context: Uint8Array
  transcript: Uint8Array
}> => {
  const source = await mkdtemp(join(tmpdir(), 'atlas-drive-source-'))
  return {
    source,
    context: await contextArchiveFrom(source),
    transcript: await transcriptArchiveFrom(source),
  }
}

describe('serve on a drive-mounted home and workspace', () => {
  it('resolves its atlas home from the environment the sandbox was created with', async () => {
    const drive = await freshDrive()
    withAtlasHome(drive.home)

    const { atlasDirectory } = await import('@dltech/atlas-harness')
    expect(atlasDirectory()).toBe(drive.home)

    const readiness = await materializeTranscript({
      fetchArchive: async () => null,
      atlasHome: atlasDirectory(),
      threadId,
    })
    expect(readiness).toEqual({ restored: false, fresh: true, failed: null })
  })

  it('boots onto a fresh empty drive, creating the workspace, context and transcript roots', async () => {
    const drive = await freshDrive()
    const { source, context, transcript } = await freshArchives()
    withAtlasHome(drive.home)
    drives.push({ root: source, home: source, workspace: source })

    const { lines } = await bootOn({
      drive,
      archives: { context, transcript },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    })

    expect(lines.some((line) => line.includes(EServeEvent.Started))).toBe(true)
    expect(lines.some((line) => line.includes(EServeEvent.ContextFailed))).toBe(false)
    expect(lines.some((line) => line.includes(EServeEvent.TranscriptFailed))).toBe(false)
    expect(lines.some((line) => line.includes(EServeEvent.TranscriptRestored))).toBe(true)
    expect(existsSync(join(drive.home, 'context.stamp'))).toBe(true)
    expect(existsSync(join(drive.home, 'ATLAS.md'))).toBe(true)
    expect(
      existsSync(join(sessionDirectory({ home: drive.home, sessionId: threadId }), 'meta.json')),
    ).toBe(true)
  })

  it('reboots as a no-op once the drive already holds the stamps', async () => {
    const drive = await freshDrive()
    const { source, context, transcript } = await freshArchives()
    withAtlasHome(drive.home)
    drives.push({ root: source, home: source, workspace: source })

    const first = await bootOn({
      drive,
      archives: { context, transcript },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    })
    await first.handle.close()
    running.pop()

    let transcriptFetches = 0
    const second = await bootOn({
      drive,
      archives: { context: new Uint8Array(), transcript: null },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Present }),
      fetchTranscriptArchive: async () => {
        transcriptFetches += 1
        return null
      },
    })
    transcriptFetches = 0

    expect(
      second.lines.some(
        (line) =>
          line.includes(EServeEvent.WorkspaceReady) && line.includes(EWorkspaceState.Present),
      ),
    ).toBe(true)
    expect(transcriptFetches).toBe(0)
    expect(second.lines.some((line) => line.includes(EServeEvent.TranscriptRestored))).toBe(false)
    expect(second.lines.some((line) => line.includes(EServeEvent.ContextReady))).toBe(false)
  })

  it('boots the model the transcript meta carries, ahead of the workspace spec', async () => {
    const drive = await freshDrive()
    const source = await mkdtemp(join(tmpdir(), 'atlas-drive-source-'))
    drives.push({ root: source, home: source, workspace: source })
    withAtlasHome(drive.home)
    const transcript = await transcriptArchiveFrom(source, {
      v: 1,
      id: threadId,
      title: 'a titled thread',
      head: 0,
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
      parentThreadId: null,
      forkSeq: null,
      forkMode: null,
      spawnerThreadId: null,
      agentType: null,
      workspace: null,
      repo: null,
      modelRef: 'anthropic/claude-opus-5',
      modelEffort: 'high',
      executionLocation: null,
    })

    let composedWith: { ref: string; effort?: string | undefined } | undefined
    await bootOn({
      drive,
      archives: { context: await contextArchiveFrom(source), transcript },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      spec: { model: 'inference-net/kimi-k3-fast' },
      compose: async (composeArgs) => {
        composedWith = composeArgs.model
        return fakeServeApp({ threadId, root: drive.workspace })
      },
    })

    expect(composedWith).toEqual({ ref: 'anthropic/claude-opus-5', effort: 'high' })
  })

  it('falls back to the workspace spec model when the transcript names none', async () => {
    const drive = await freshDrive()
    const source = await mkdtemp(join(tmpdir(), 'atlas-drive-source-'))
    drives.push({ root: source, home: source, workspace: source })
    withAtlasHome(drive.home)
    const transcript = await transcriptArchiveFrom(source)

    let composedWith: { ref: string; effort?: string | undefined } | undefined
    await bootOn({
      drive,
      archives: { context: await contextArchiveFrom(source), transcript },
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      spec: { model: 'inference-net/kimi-k3-fast' },
      compose: async (composeArgs) => {
        composedWith = composeArgs.model
        return fakeServeApp({ threadId, root: drive.workspace })
      },
    })

    expect(composedWith).toEqual({ ref: 'inference-net/kimi-k3-fast' })
  })

  it('materializes into a workspace directory the drive does not hold yet', async () => {
    const drive = await freshDrive()
    const { createEnsureWorkspace } = await import('../materialize-workspace')

    const readiness = await createEnsureWorkspace({})({
      cwd: drive.workspace,
      fetchSpec: async () => bareSpec,
    })

    expect(readiness.state).toBe(EWorkspaceState.Skipped)
    expect(existsSync(join(drive.workspace, WORKSPACE_SENTINEL))).toBe(false)

    const transcript = await materializeTranscript({
      fetchArchive: async () => null,
      atlasHome: drive.home,
      threadId,
    })
    expect(transcript.failed).toBeNull()
  })
})
