import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Event } from '@dltech/atlas-core'
import {
  createRemoteDeltaChannel,
  decodeServeFrame,
  EChannelConnection,
  EServeFrame,
  LocalCompaction,
  mirrorWriter,
  RemoteCompaction,
  RemoteEventLog,
  TranscriptSyncer,
  type ChannelReload,
  type ChannelSocketFactory,
  type RemoteDeltaChannel,
  type ServeFrame,
  type Summariser,
} from '@dltech/atlas-harness'

import { openStoreFixture, type StoreFixture } from '../../../../packages/harness/src/store/__tests__/harness'
import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { openSeededStore } from './cloud-compaction-fixture'
import { fakeRewindTarget, fakeServeApp, type FakeServeApp } from './fakes'
import { gate, threadId, TOKEN, until } from './serve-remote-fixture'
export { gate, threadId, TOKEN, until }

const noFiles = (): WorkspaceFiles => ({
  exists: async () => false,
  read: async () => '',
  write: async () => undefined,
  writeBytes: async () => undefined,
  ensureDirectory: async () => undefined,
  empty: async () => undefined,
})

export type HeadGate = {
  log: StoreFixture['log']
  hold: () => void
  release: () => void
  entered: () => Promise<void>
}

export const gatedHeads = (inner: StoreFixture['log']): HeadGate => {
  let held = false
  let opened = gate()
  let enteredGate = gate()
  const log = Object.create(inner) as StoreFixture['log']
  log.head = async (given) => {
    const value = await inner.head(given)
    if (!held) return value
    enteredGate.open()
    await opened.opened
    return value
  }
  return {
    log,
    hold: () => {
      held = true
      opened = gate()
      enteredGate = gate()
    },
    release: () => {
      held = false
      opened.open()
    },
    entered: () => enteredGate.opened,
  }
}

export type RecoveryServe = {
  store: StoreFixture
  app: FakeServeApp
  handle: ServeHandle
  heads: HeadGate
  writes: { events: string[]; release: () => void }
}

const homes: string[] = []
const running: ServeHandle[] = []
const stores: StoreFixture[] = []
const channels: RemoteDeltaChannel[] = []
let heldAtlasHome: string | undefined

export const startRecoveryServe = async (args: {
  summariser: Summariser
  bufferSize?: number
  drainDeadlineMs?: number
  holdStoreWrite?: boolean
}): Promise<RecoveryServe> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-recovery-home-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  mkdirSync(join(home, 'bootstrap'), { recursive: true })
  writeFileSync(
    join(home, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({ remoteUrl: null, branch: null, commit: null, patch: '', githubToken: null, contextBundle: null }),
  )

  const store = await openSeededStore()
  stores.push(store)
  const heads = gatedHeads(store.log)

  const events: string[] = []
  const writeGate = gate()
  let hold = args.holdStoreWrite === true
  const gated = Object.create(store.threads) as StoreFixture['threads']
  const gateWrite = (name: 'compact' | 'summarise') => {
    gated[name] = async (given) => {
      events.push(`${name}-start`)
      if (hold) await writeGate.opened
      const replaced = await store.threads[name](given)
      events.push(`${name}-done`)
      return replaced
    }
  }
  gateWrite('compact')
  gateWrite('summarise')

  const base = fakeServeApp({ threadId, root: '/workspace', intake: true, log: heads.log })
  const served: FakeServeApp = {
    ...base,
    threads: store.threads,
    close: async () => {
      events.push('app-close')
      await base.close()
    },
    compaction: new LocalCompaction({
      log: store.log,
      threads: gated,
      agents: store.agents,
      summarise: args.summariser,
    }),
    rewind: { target: fakeRewindTarget(), truncate: async () => undefined },
  }

  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: {},
    cwd: '/workspace',
    compose: async () => served,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: noFiles(),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
    ...(args.bufferSize === undefined ? {} : { bufferSize: args.bufferSize }),
    ...(args.drainDeadlineMs === undefined ? {} : { drainDeadlineMs: args.drainDeadlineMs }),
  })
  running.push(handle)

  return {
    store,
    app: served,
    handle,
    heads,
    writes: {
      events,
      release: () => {
        hold = false
        writeGate.open()
      },
    },
  }
}

type ReadyFrame = Extract<ServeFrame, { kind: EServeFrame.Ready }>

export type Mirrored = {
  channel: RemoteDeltaChannel
  mirror: StoreFixture
  reloads: ChannelReload[]
  frames: ServeFrame[]
  retries: (() => void)[]
  compaction: RemoteCompaction
  drop: () => void
  reconnect: () => Promise<void>
  synced: () => Promise<Event[]>
  readies: () => ReadyFrame[]
}

export const attachMirrored = async (args: {
  port: number
  dropFrame?: (frame: ServeFrame) => boolean
}): Promise<Mirrored> => {
  const mirror = openStoreFixture()
  stores.push(mirror)
  await mirror.threads.create({ id: threadId, title: 'mirror' })
  const frames: ServeFrame[] = []
  const retries: (() => void)[] = []
  let current: { close: () => void } | null = null

  const socketFactory: ChannelSocketFactory = ({ url, protocols, handlers }) => {
    const socket = new WebSocket(url, [...protocols])
    socket.onopen = () => handlers.handleOpen()
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = decodeServeFrame(event.data)
      if (frame !== null) frames.push(frame)
      if (frame !== null && args.dropFrame?.(frame) === true) return
      handlers.handleMessage(event.data)
    }
    socket.onclose = () => handlers.handleClose()
    socket.onerror = () => handlers.handleError('socket error')
    current = socket
    return {
      send: (data) => socket.send(data),
      close: () => socket.close(),
      isOpen: () => socket.readyState === WebSocket.OPEN,
    }
  }

  const channel = createRemoteDeltaChannel({
    threadId,
    url: `http://127.0.0.1:${args.port}`,
    token: TOKEN,
    socketFactory,
    lastEventSeq: () => mirror.log.head({ threadId }),
    scheduleRetry: (retry) => void retries.push(retry.run),
  })
  channels.push(channel)

  const reloads: ChannelReload[] = []
  channel.onReload((reload) => void reloads.push(reload))
  const syncer = new TranscriptSyncer({
    channel,
    remote: new RemoteEventLog({ channel }),
    local: mirror.log,
    writer: mirrorWriter({ home: () => mirror.home }),
    threadId,
  })
  await until({ what: 'the channel to open', condition: () => channel.connection().state === EChannelConnection.Open })
  await until({ what: 'the first attach to reload the log', condition: () => reloads.length >= 1 })
  await syncer.converge()
  reloads.length = 0
  frames.length = 0

  return {
    channel,
    mirror,
    reloads,
    frames,
    retries,
    compaction: new RemoteCompaction({ channel }),
    drop: () => current?.close(),
    reconnect: async () => {
      const retry = retries.shift()
      if (retry === undefined) throw new Error('no reconnect was scheduled')
      retry()
      await until({
        what: 'the channel to reopen',
        condition: () => channel.connection().state === EChannelConnection.Open,
      })
    },
    synced: async () => {
      await syncer.converge()
      const remote = new RemoteEventLog({ channel })
      for (let waited = 0; waited < 2_000; waited += 1) {
        syncer.kick()
        await syncer.converge()
        await mirror.log.refresh({ threadId })
        if ((await mirror.log.head({ threadId })) === (await remote.head({ threadId }))) break
        await Bun.sleep(1)
      }
      return mirror.log.readOwn({ threadId })
    },
    readies: () => frames.filter((frame): frame is ReadyFrame => frame.kind === EServeFrame.Ready),
  }
}

export const serverEvents = async (served: RecoveryServe): Promise<Event[]> => {
  await served.store.log.refresh({ threadId })
  return served.store.log.readOwn({ threadId })
}

export const seqTypes = (events: readonly Event[]): string[] =>
  events.map((event) => `${event.seq}:${event.type}:${event.id}`)

export const eventually = async (args: { what: string; probe: () => Promise<boolean> }): Promise<void> => {
  for (let waited = 0; waited < 2_000; waited += 1) {
    if (await args.probe()) return
    await Bun.sleep(1)
  }
  throw new Error(`waited too long for ${args.what}`)
}

export const releaseRecoveryServe = async (): Promise<void> => {
  while (channels.length > 0) channels.pop()?.close()
  while (running.length > 0) await running.pop()?.close()
  while (stores.length > 0) await stores.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
}
