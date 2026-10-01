import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { buildSessionArchive } from '@dltech/atlas-harness'
import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import type { FakeServeApp } from './fakes'
import { scratchTranscriptStore, type TranscriptStore } from './transcript-store-fixture'

export const RESTORE_TOKEN = 'session-token'
export const RESTORE_THREAD = toThreadId('thread-lift-restore')
export const RESTORE_CONTROL_PLANE = 'https://api.example.com'

export const restoreHomes: string[] = []
export const runningServes: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (runningServes.length > 0) await runningServes.pop()?.close()
  for (const home of restoreHomes.splice(0, restoreHomes.length)) {
    rmSync(home, { recursive: true, force: true })
  }
})

export const freshRestoreHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-restore-'))
  restoreHomes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  return home
}

export const wireRealLog = (args: { home: string; app: FakeServeApp }): TranscriptStore => {
  const store = scratchTranscriptStore({ prefix: 'live', home: args.home })
  args.app.log = store.log
  return store
}

export const seedArchive = async (args: { texts: readonly string[] }): Promise<Uint8Array> => {
  const source = scratchTranscriptStore({ prefix: 'src' })
  restoreHomes.push(source.home)
  for (const text of args.texts) {
    await source.appendSaid({ threadId: RESTORE_THREAD, text })
  }
  const archive = await buildSessionArchive({
    sessionDir: sessionDirectory({ home: source.home, sessionId: RESTORE_THREAD }),
  })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

export const bootRestoreServe = async (args: {
  home: string
  archive: () => Promise<Uint8Array | null>
  app: FakeServeApp
  capabilities?: import('@dltech/atlas-core').EnvironmentCapabilities
}): Promise<{ handle: ServeHandle; client: TestClient }> => {
  const handle = await startServe({
    threadId: RESTORE_THREAD,
    port: 0,
    token: RESTORE_TOKEN,
    controlPlaneUrl: RESTORE_CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => args.app,
    ensureWorkspace: async () => ({
      state: EWorkspaceState.Skipped,
      ...(args.capabilities === undefined
        ? {}
        : { profile: { steps: [], capabilities: args.capabilities } }),
    }),
    fetchTranscriptArchive: args.archive,
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  runningServes.push(handle)
  const client = await connect({ port: handle.port, token: RESTORE_TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId: RESTORE_THREAD, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { handle, client }
}

export const askRestore = async (
  client: TestClient,
  id: string,
): Promise<{ ok: boolean; restored: boolean; message: string | null }> => {
  client.send({ kind: EClientFrame.Request, id, op: EClientRequest.RestoreTranscript, params: {} })
  const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id)
  if (reply.kind !== EServeFrame.Reply) throw new Error('expected a reply')
  const data = reply.data as { restored?: boolean; message?: string }
  return { ok: reply.ok, restored: data.restored ?? false, message: data.message ?? null }
}

export const readSaid = async (
  client: TestClient,
  id: string,
): Promise<readonly { id: string; text: string }[]> => {
  client.send({
    kind: EClientFrame.Request,
    id,
    op: EClientRequest.ReadEvents,
    params: { threadId: RESTORE_THREAD },
  })
  const reply = await client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id)
  if (reply.kind !== EServeFrame.Reply) throw new Error('expected a reply')
  if (!reply.ok) throw new Error(`read-events was refused: ${JSON.stringify(reply.data)}`)
  const events = (reply.data as { events: { id: string; type: string; body: string }[] }).events
  return events.flatMap((event) =>
    event.type === 'user-said'
      ? [{ id: event.id, text: (JSON.parse(event.body) as { text: string }).text }]
      : [],
  )
}

export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

export const restoreEventFile = (home: string): string =>
  eventLogFile({
    sessionDir: sessionDirectory({ home, sessionId: RESTORE_THREAD }),
    threadId: RESTORE_THREAD,
  })
