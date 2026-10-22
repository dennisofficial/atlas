import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { RESUME_NUDGE, toRunId, toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore } from './transcript-store-fixture'

const TOKEN = 'session-token'

const threadId = toThreadId('thread-resume-disk')

const homes: string[] = []
let heldAtlasHome: string | undefined
const running: ServeHandle[] = []

const noFiles = (): WorkspaceFiles => ({
  exists: async () => false,
  read: async () => {
    throw new Error('no such file')
  },
  write: async () => undefined,
  writeBytes: async () => undefined,
  ensureDirectory: async () => undefined,
  empty: async () => undefined,
})

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

describe('a resume run frame against the on-disk event log', () => {
  it('derives the nudge from the sandbox JSONL and appends it exactly once', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-resume-disk-'))
    homes.push(home)
    heldAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    await mkdir(join(home, 'bootstrap'), { recursive: true })
    await writeFile(
      join(home, 'bootstrap', 'workspace-spec.json'),
      JSON.stringify({
        remoteUrl: null,
        branch: null,
        commit: null,
        patch: '',
        githubToken: null,
        contextBundle: null,
      }),
    )

    const store = scratchTranscriptStore({ prefix: 'disk', home })
    await store.log.append({
      threadId,
      runId: toRunId('disk-seed'),
      drafts: [
        { type: 'user-said', text: 'build the thing' },
        { type: 'assistant-said', parts: [{ type: 'text', text: 'partway through' }], interrupted: true },
      ],
    })

    const app = fakeServeApp({ threadId, root: '/workspace', intake: true, log: store.log })
    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: 'https://api.example.com',
      env: {},
      cwd: '/workspace',
      compose: async () => app,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: noFiles(),
      fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    })
    running.push(handle)

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    const nudgesOnDisk = async (): Promise<number> =>
      (await store.log.read({ threadId })).filter(
        (event) => event.type === 'nudge' && event.text === RESUME_NUDGE,
      ).length

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
    expect(await nudgesOnDisk()).toBe(1)

    client.send({ kind: EClientFrame.Run, resume: true })
    await client.waitFor(
      () => client.frames.filter((frame) => frame.kind === EServeFrame.TurnEnded).length === 2,
    )
    expect(await nudgesOnDisk()).toBe(1)

    const events = await store.log.read({ threadId })
    expect(events.filter((event) => event.type === 'user-said')).toHaveLength(1)
  })
})
