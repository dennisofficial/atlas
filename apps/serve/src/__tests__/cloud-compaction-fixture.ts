import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toCallId, toRunId, type Event, type EventDraft } from '@dltech/atlas-core'
import {
  eventLogFile,
  LocalCompaction,
  RemoteCompaction,
  RemoteEventLog,
  sessionDirectory,
  type Summariser,
} from '@dltech/atlas-harness'

import { openStoreFixture, type StoreFixture } from '../../../../packages/harness/src/store/__tests__/harness'
import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'
import type { ServeApp } from '../serve-app'

import { fakeRewindTarget, fakeServeApp } from './fakes'
import { attach, gate, releaseServing, threadId, TOKEN, type Attached } from './serve-remote-fixture'

export { gate, threadId }

export const said = (text: string): EventDraft => ({ type: 'user-said', text })
export const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const callId = toCallId('call-read')

export const conversation: readonly EventDraft[] = [
  said('one'),
  replied('two'),
  said('three'),
  { type: 'context-loaded', slot: 'project', key: 'AGENTS.md', content: 'be careful' },
  { type: 'tool-called', callId, name: 'read', input: { path: 'a.ts' }, ordinal: 0 },
  { type: 'tool-result', callId, name: 'read', output: 'file body' },
  replied('four'),
  said('five'),
  replied('six'),
]

export const seqOf = (args: { events: readonly Event[]; match: string }): number => {
  const found = args.events.find((event) =>
    event.type === 'user-said'
      ? event.text === args.match
      : event.type === 'assistant-said'
        ? event.parts.some((part) => part.type === 'text' && part.text === args.match)
        : event.type === args.match,
  )
  if (found === undefined) throw new Error(`no event matching ${args.match}`)
  return found.seq
}

export type SummariserProbe = {
  summariser: Summariser
  calls: { fromSeq: number; throughSeq: number; signal: AbortSignal | undefined }[]
  entered: Promise<void>
  release: () => void
}

export const probeSummariser = (args: { held?: boolean; honoursAbort?: boolean } = {}): SummariserProbe => {
  const calls: SummariserProbe['calls'] = []
  const entered = gate()
  const released = gate()
  if (args.held !== true) released.open()

  const summariser: Summariser = async ({ fromSeq, throughSeq, signal }) => {
    calls.push({ fromSeq, throughSeq, signal })
    entered.open()
    if (args.honoursAbort === true && signal !== undefined) {
      const aborted = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      await Promise.race([released.opened, aborted])
    } else {
      await released.opened
    }
    return 'deterministic summary'
  }

  return { summariser, calls, entered: entered.opened, release: released.open }
}

export type JsonlRow = { seq: number; type: string }

export const jsonlRows = (store: StoreFixture): JsonlRow[] => {
  const sessionDir = sessionDirectory({ home: store.home, sessionId: threadId })
  return readFileSync(eventLogFile({ sessionDir, threadId }), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): JsonlRow => {
      const row: JsonlRow = JSON.parse(line)
      return { seq: row.seq, type: row.type }
    })
}

export const openSeededStore = async (): Promise<StoreFixture> => {
  const store = openStoreFixture()
  await store.threads.create({ id: threadId, title: 'compaction' })
  await store.log.append({ threadId, runId: toRunId('seed-run'), drafts: conversation })
  return store
}

const inMemoryContextFiles = (): WorkspaceFiles => {
  const stored = new Map<string, string>()
  return {
    exists: async (path) => stored.has(path),
    read: async (path) => stored.get(path) ?? '',
    write: async ({ path, text }) => void stored.set(path, text),
    writeBytes: async ({ path, bytes }) => void stored.set(path, bytes.toString('utf8')),
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
}

export type CompactionServe = {
  store: StoreFixture
  client: Attached
  secondClient: () => Promise<Attached>
  compaction: RemoteCompaction
  remoteLog: RemoteEventLog
  truncations: unknown[]
  agentCalls: string[]
  turn: { entered: Promise<void>; release: () => void }
}

const homes: string[] = []
const running: ServeHandle[] = []
const stores: StoreFixture[] = []
const turnGates: { open: () => void }[] = []
let heldAtlasHome: string | undefined

export const startCompactionServe = async (args: {
  summariser: Summariser
  holdTurn?: boolean
}): Promise<CompactionServe> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-compaction-home-'))
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

  const turnEntered = gate()
  const turnReleased = gate()
  if (args.holdTurn !== true) turnReleased.open()
  turnGates.push(turnReleased)

  const truncations: unknown[] = []
  const agentCalls: string[] = []
  const base = fakeServeApp({
    threadId,
    root: '/workspace',
    intake: true,
    log: store.log,
    holdStep: () => {
      turnEntered.open()
      return turnReleased.opened
    },
  })
  const served: ServeApp = {
    ...base,
    threads: store.threads,
    compaction: new LocalCompaction({
      log: store.log,
      threads: store.threads,
      agents: store.agents,
      summarise: args.summariser,
    }),
    rewind: { target: fakeRewindTarget(), truncate: async (given) => void truncations.push(given) },
    agents: {
      say: (given) => (agentCalls.push('say'), store.agents.say(given)),
      resume: (given) => (agentCalls.push('resume'), store.agents.resume(given)),
      stop: (given) => (agentCalls.push('stop'), store.agents.stop(given)),
    },
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
    contextFiles: inMemoryContextFiles(),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
  })
  running.push(handle)

  const client = await attach({ port: handle.port })
  return {
    store,
    client,
    secondClient: () => attach({ port: handle.port }),
    compaction: new RemoteCompaction({ channel: client.channel }),
    remoteLog: new RemoteEventLog({ channel: client.channel }),
    truncations,
    agentCalls,
    turn: { entered: turnEntered.opened, release: turnReleased.open },
  }
}

export const releaseCompactionServe = async (): Promise<void> => {
  while (turnGates.length > 0) turnGates.pop()?.open()
  await releaseServing()
  while (running.length > 0) await running.pop()?.close()
  while (stores.length > 0) await stores.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
}
