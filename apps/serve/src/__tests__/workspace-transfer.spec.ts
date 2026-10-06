import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId, type Event } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, EServeFrame, type RestoredWorkspace } from '@dltech/atlas-harness'
import type { WorkspaceManifest } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { prepareWorkspaceExport } from '../prepare-workspace'
import { connect } from './client'
import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-transfer')

const roots: string[] = []
const running: ServeHandle[] = []
let heldHome: string | undefined

const freshRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-workspace-transfer-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
  if (heldHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldHome
  heldHome = undefined
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const manifestFor = (cwd: string): WorkspaceManifest => ({
  version: 1,
  repository: null,
  activeId: 'main',
  activeRelativePath: '',
  trees: [
    {
      id: 'main',
      name: 'main',
      sourcePath: cwd,
      originPath: cwd,
      branch: null,
      head: null,
      baseline: null,
      fingerprint: 'f',
      isMain: true,
    },
  ],
})

const event = (partial: Record<string, unknown>): Event =>
  ({ id: 'e', seq: 1, threadId, runId: 'r', depth: 0, at: '2026-10-01T00:00:00.000Z', ...partial }) as Event

describe('preparing a workspace export', () => {
  it('captures the current entered worktree, outside the workspace, in the export directory', async () => {
    const home = await freshRoot()
    const captured: string[] = []

    const reply = await prepareWorkspaceExport({
      driveHome: home,
      threadId,
      launchDirectory: '/atlas/workspace',
      requireCoverage: async () => undefined,
      log: {
        readOwn: async () => [
          event({ type: 'worktree-entered', path: '/atlas/workspace/.atlas/worktrees/feature', branch: 'feature' }),
        ],
      },
      capture: async ({ cwd, destination }) => {
        captured.push(cwd)
        await writeFile(destination, 'tar')
        return manifestFor(cwd)
      },
    })

    expect(captured).toEqual(['/atlas/workspace/.atlas/worktrees/feature'])
    expect(reply.path.startsWith(join(home, 'exports', 'workspace-'))).toBe(true)
    expect(reply.path.endsWith('.tar.gz')).toBe(true)
    expect(existsSync(reply.path)).toBe(true)
    expect(reply.totalBytes).toBe((await stat(reply.path)).size)
    expect(reply.totalBytes).toBe(3)
    expect(reply.manifest.trees[0]?.sourcePath).toBe('/atlas/workspace/.atlas/worktrees/feature')
  })

  it('stops background processes before capturing and clears older exports', async () => {
    const home = await freshRoot()
    await mkdir(join(home, 'exports'), { recursive: true })
    await writeFile(join(home, 'exports', 'workspace-old.tar.gz'), 'stale')
    const order: string[] = []

    await prepareWorkspaceExport({
      driveHome: home,
      threadId,
      launchDirectory: '/atlas/workspace',
      requireCoverage: async () => undefined,
      log: { readOwn: async () => [] },
      stopProcesses: async () => {
        order.push('stop')
      },
      capture: async ({ cwd, destination }) => {
        order.push('capture')
        await writeFile(destination, 'tar')
        return manifestFor(cwd)
      },
    })

    expect(order).toEqual(['stop', 'capture'])
    expect(await readdir(join(home, 'exports'))).toHaveLength(1)
  })

  it('leaves no partial export when the capture fails', async () => {
    const home = await freshRoot()

    await expect(
      prepareWorkspaceExport({
        driveHome: home,
        threadId,
        launchDirectory: '/atlas/workspace',
        requireCoverage: async () => undefined,
        log: { readOwn: async () => [] },
        capture: async ({ destination }) => {
          await writeFile(destination, 'half')
          throw new Error('the tree changed while it was read')
        },
      }),
    ).rejects.toThrow('the tree changed')

    expect(await readdir(join(home, 'exports'))).toEqual([])
  })
})

const restoredAt = (cwd: string): RestoredWorkspace => ({
  cwd,
  repository: cwd,
  trees: [{ id: 'main', sourcePath: '/host/repo', path: cwd, branch: null, renamedFrom: null }],
})

const bootWith = async (args: { archive: string | null }) => {
  const root = await freshRoot()
  const home = join(root, 'home')
  const configured = join(root, 'workspace')
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  await writeFile(
    join(home, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({ remoteUrl: null, branch: null, commit: null, patch: '', githubToken: null }),
  )
  if (args.archive !== null) await writeFile(join(home, 'bootstrap', 'workspace.tar.gz'), args.archive)
  heldHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const composedAt: string[] = []
  const restoredTo = join(configured, 'restored')
  await mkdir(restoredTo, { recursive: true })
  const handle = await startServe({
    env: {},
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    cwd: configured,
    write: () => undefined,
    compose: async (composeArgs) => {
      composedAt.push(composeArgs.cwd)
      return fakeServeApp({ threadId, root: composeArgs.cwd })
    },
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    restoreWorkspace: async () => restoredAt(restoredTo),
    captureWorkspace: async ({ cwd, destination }) => {
      await writeFile(destination, 'tar')
      return manifestFor(cwd)
    },
    fetchTranscriptArchive: async () => null,
  })
  running.push(handle)
  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { client, composedAt, restoredTo, home, configured }
}

const ask = async (client: Awaited<ReturnType<typeof connect>>, id: string, op: EClientRequest) => {
  client.send({ kind: EClientFrame.Request, id, op, params: {} })
  const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id)
  if (reply.kind !== EServeFrame.Reply) throw new Error('expected a reply')
  return reply
}

describe('serving a restored direct workspace', () => {
  it('composes on the restored cwd, stays dormant until activated, then accepts work', async () => {
    const { client, composedAt, restoredTo } = await bootWith({ archive: 'generation' })

    expect(composedAt).toEqual([restoredTo])

    client.send({ kind: EClientFrame.Send, sendId: 's-1' as never, text: 'hello' })
    const refused = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(refused.kind === EServeFrame.Error ? refused.message : '').toContain('activated')

    const activated = await ask(client, 'act-1', EClientRequest.ActivateSession)
    expect(activated).toMatchObject({ ok: true, data: { activated: true } })
    const again = await ask(client, 'act-2', EClientRequest.ActivateSession)
    expect(again).toMatchObject({ ok: true, data: { activated: true } })

    client.send({ kind: EClientFrame.Send, sendId: 's-2' as never, text: 'hello' })
    await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked)
  }, 15_000)

  it('keeps an already-activated generation active across a reboot', async () => {
    const first = await bootWith({ archive: 'generation' })
    await ask(first.client, 'act-1', EClientRequest.ActivateSession)
    await running.pop()?.close()

    process.env.ATLAS_HOME = first.home
    const handle = await startServe({
      env: {},
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: 'https://api.example.com',
      cwd: first.configured,
      write: () => undefined,
      compose: async (composeArgs) => fakeServeApp({ threadId, root: composeArgs.cwd }),
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchTranscriptArchive: async () => null,
    })
    running.push(handle)
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 's-3' as never, text: 'hello' })
    await client.waitFor((frame) => frame.kind === EServeFrame.SendAcked)
  }, 15_000)

  it('prepares an export over the wire and applies a new generation on a healthy serve', async () => {
    const { client, home } = await bootWith({ archive: null })

    const prepared = await ask(client, 'prep-1', EClientRequest.PrepareWorkspaceArchive)
    expect(prepared.ok).toBe(true)
    const path = (prepared.data as { path: string }).path
    expect(path.startsWith(join(home, 'exports', 'workspace-'))).toBe(true)

    const none = await ask(client, 'apply-0', EClientRequest.ApplyWorkspaceArchive)
    expect(none.ok).toBe(false)

    await writeFile(join(home, 'bootstrap', 'workspace.tar.gz'), 'next-generation')
    const applied = await ask(client, 'apply-1', EClientRequest.ApplyWorkspaceArchive)
    expect(applied).toMatchObject({ ok: true, data: { applied: true } })
    const repeat = await ask(client, 'apply-2', EClientRequest.ApplyWorkspaceArchive)
    expect(repeat).toMatchObject({ ok: true, data: { applied: false } })
  })
})
