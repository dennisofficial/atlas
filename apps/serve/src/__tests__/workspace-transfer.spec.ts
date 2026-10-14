import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, EServeFrame, type RestoredWorkspace } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
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
      const app = fakeServeApp({ threadId, root: composeArgs.cwd })
      const find = app.threads.find.bind(app.threads)
      app.threads.find = async (given) => {
        const thread = await find(given)
        return thread === undefined ? undefined : { ...thread, workspace: composeArgs.cwd }
      }
      return app
    },
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    restoreWorkspace: async () => restoredAt(restoredTo),
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

  it('applies a new generation on a healthy serve', async () => {
    const { client, home } = await bootWith({ archive: null })

    const none = await ask(client, 'apply-0', EClientRequest.ApplyWorkspaceArchive)
    expect(none.ok).toBe(false)

    await writeFile(join(home, 'bootstrap', 'workspace.tar.gz'), 'next-generation')
    const applied = await ask(client, 'apply-1', EClientRequest.ApplyWorkspaceArchive)
    expect(applied).toMatchObject({ ok: true, data: { applied: true } })
    const repeat = await ask(client, 'apply-2', EClientRequest.ApplyWorkspaceArchive)
    expect(repeat).toMatchObject({ ok: true, data: { applied: false } })
  })
})
