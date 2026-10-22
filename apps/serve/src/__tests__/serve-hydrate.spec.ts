import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import {
  readMetaSync,
  registryFor,
  sessionDirectory,
  threadMetaFile,
  threadMetaSchema,
  type WireEvent,
} from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV, BOOT_STEP_EVENT_TYPE } from '@dltech/atlas-wire'

import { hydrateServeHistory, hydrateWhenApiProvisioned } from '../serve-hydrate'

import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-hydrate')
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-hydrate-'))
  homes.push(home)
  return home
}

const wireRow = (args: {
  seq: number
  type: string
  body: Record<string, unknown>
}): WireEvent => ({
  id: `pg-${args.seq}`,
  threadId,
  seq: args.seq,
  runId: 'run-web',
  depth: 0,
  at: '2026-10-22T00:00:00.000Z',
  type: args.type,
  body: JSON.stringify({ type: args.type, ...args.body }),
})

const userSaid = (seq: number, text: string): WireEvent =>
  wireRow({ seq, type: 'user-said', body: { text, requestId: 'send-1' } })

const bootStep = (seq: number): WireEvent =>
  wireRow({ seq, type: BOOT_STEP_EVENT_TYPE, body: { step: 'provision', state: 'running' } })

const hydrate = (args: { home: string; rows: WireEvent[] }) =>
  hydrateServeHistory({
    atlasHome: args.home,
    threadId,
    log: () => undefined,
    sessions: { readEvents: async () => args.rows },
  })

describe('hydrateServeHistory', () => {
  it('imports core events past the local head with their Postgres seqs', async () => {
    const home = newHome()

    const result = await hydrate({ home, rows: [userSaid(1, 'first'), userSaid(2, 'second')] })

    expect(result).toEqual({ imported: 2, skipped: 0, head: 2 })
    const events = await scratchTranscriptStore({ prefix: 'read', home }).log.read({ threadId })
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'user-said'],
      [2, 'user-said'],
    ])
    const first = events[0]
    expect(first?.type === 'user-said' && first.requestId).toBe('send-1')
  })

  it('skips legacy boot-step rows and unreadable bodies, keeping the surrounding seqs', async () => {
    const home = newHome()
    const unreadable = wireRow({ seq: 4, type: 'not-a-core-event', body: {} })

    const result = await hydrate({
      home,
      rows: [bootStep(1), bootStep(2), userSaid(3, 'real'), unreadable],
    })

    expect(result).toEqual({ imported: 1, skipped: 3, head: 4 })
    const events = await scratchTranscriptStore({ prefix: 'read', home }).log.read({ threadId })
    expect(events.map((event) => event.seq)).toEqual([3])
  })

  it('raises the local head past a skipped tail so the next local seq cannot collide', async () => {
    const home = newHome()

    await hydrate({ home, rows: [userSaid(1, 'real'), bootStep(2), bootStep(3)] })

    const sessionDir = sessionDirectory({ home, sessionId: threadId })
    const meta = readMetaSync({
      file: threadMetaFile({ sessionDir, threadId }),
      schema: threadMetaSchema,
    })
    expect(meta?.head).toBe(3)
    const store = scratchTranscriptStore({ prefix: 'next', home })
    const [appended] = await store.log.append({
      threadId,
      runId: toRunId('run-next'),
      drafts: [{ type: 'user-said', text: 'after' }],
    })
    expect(appended?.seq).toBe(4)
  })

  it('imports only rows past the existing local head', async () => {
    const home = newHome()
    await hydrate({ home, rows: [userSaid(1, 'one'), userSaid(2, 'two')] })
    registryFor({ home }).invalidateSession({
      sessionDir: sessionDirectory({ home, sessionId: threadId }),
    })

    const result = await hydrate({
      home,
      rows: [userSaid(1, 'one'), userSaid(2, 'two'), userSaid(3, 'three')],
    })

    expect(result).toEqual({ imported: 1, skipped: 0, head: 3 })
    const events = await scratchTranscriptStore({ prefix: 'read', home }).log.read({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('imports nothing and leaves no log when Postgres holds nothing', async () => {
    const home = newHome()

    expect(await hydrate({ home, rows: [] })).toEqual({ imported: 0, skipped: 0, head: 0 })
  })
})

describe('hydrateWhenApiProvisioned', () => {
  const failingFetch = (async () => {
    throw new Error('the control plane must not be called')
  }) as unknown as typeof fetch

  it('does nothing when the sandbox was not provisioned by the API', async () => {
    const home = newHome()

    await hydrateWhenApiProvisioned({
      env: {},
      atlasHome: home,
      threadId,
      controlPlaneUrl: 'https://api.example.com',
      token: 't',
      clientVersion: 'dev',
      fetchFn: failingFetch,
      log: () => undefined,
    })
  })

  it('reads the thread own events from the control plane with the sandbox token', async () => {
    const home = newHome()
    const requests: { url: string; authorization: string | null }[] = []
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return Response.json([userSaid(1, 'first')])
    }) as unknown as typeof fetch

    await hydrateWhenApiProvisioned({
      env: { [API_PROVISIONED_ENV]: '1' },
      atlasHome: home,
      threadId,
      controlPlaneUrl: 'https://api.example.com/',
      token: 'serve-token',
      clientVersion: 'dev',
      fetchFn,
      log: () => undefined,
    })

    expect(requests).toEqual([
      {
        url: `https://api.example.com/v1/threads/${threadId}/events?own=true`,
        authorization: 'Bearer serve-token',
      },
    ])
  })

  it('rethrows a failed read after logging it', async () => {
    const home = newHome()
    const lines: string[] = []

    await expect(
      hydrateWhenApiProvisioned({
        env: { [API_PROVISIONED_ENV]: '1' },
        atlasHome: home,
        threadId,
        controlPlaneUrl: 'https://api.example.com',
        token: 't',
        clientVersion: 'dev',
        fetchFn: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
        log: (line) => lines.push(line.event),
      }),
    ).rejects.toThrow()
    expect(lines).toEqual(['serve.hydrate-failed'])
  })
})
