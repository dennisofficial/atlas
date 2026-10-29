import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('thread-processes')
const TOKEN = 'session-token'

const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const scratch = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-processes-'))
  homes.push(home)
  return home
}

describe('the process-control router branch', () => {
  it('refuses the ops on a serve composed without process registries', async () => {
    heldAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = scratch()
    const app = fakeServeApp({ threadId, root: '/workspace' })
    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: 'https://api.example.com',
      env: {},
      cwd: '/workspace',
      compose: async () => app,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    })
    running.push(handle)
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: 0,
    })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({
      kind: EClientFrame.Request,
      id: 'kill-4',
      op: EClientRequest.KillShell,
      params: { threadId, shellId: 'shell-1' },
    })
    const reply = await client.waitFor(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'kill-4',
    )

    expect(reply).toMatchObject({
      ok: false,
      data: { message: 'this serve holds no process registries' },
    })
  })
})
