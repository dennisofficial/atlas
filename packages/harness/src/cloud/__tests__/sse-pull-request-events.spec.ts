import { afterEach, describe, expect, it } from 'bun:test'
import type { LogPort } from '@dltech/atlas-core'

import { EForge, type RepositoryCheckout } from '../../plugins/github/pure'
import type { PrEventFrame } from '../pr-event-frame'
import { SsePullRequestPort } from '../sse-pull-requests'
import { eventChunk, openStreamResponse, STREAM_PROCEDURE, trpcOk } from './trpc-fakes'

const CHECKOUT: RepositoryCheckout = {
  directory: '/repo',
  branch: 'feature',
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'owner', repo: 'repo' },
}

const STATE = {
  repoFullName: 'owner/repo',
  prNumber: 42,
  title: 'events',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'open',
  headBranch: 'feature',
  headSha: 'abc',
  checksRunning: 1,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
  updatedAt: '2026-10-08T00:00:00Z',
}

const goodFrame = {
  id: 'evt_1',
  repoFullName: 'owner/repo',
  prNumber: 42,
  kind: 'comment',
  payload: {
    url: 'https://github.com/owner/repo/pull/42#c1',
    authorLogin: 'octocat',
    body: 'hi',
    futureField: 1,
  },
  createdAt: '2026-10-08T00:00:00Z',
}

const serve = () => {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path.endsWith('/githubSubscriptions.subscribe')) {
        return trpcOk({
          id: 'sub_1',
          repoFullName: 'owner/repo',
          prNumber: 42,
          branch: 'feature',
          pollBacked: false,
          expiresAt: '2026-10-08T01:00:00Z',
          state: STATE,
        })
      }
      if (!path.endsWith(`/${STREAM_PROCEDURE}`)) return trpcOk(null)
      return openStreamResponse({
        request,
        register: (controller) => streams.add(controller),
        onAbort: () => streams.clear(),
      })
    },
  })
  return {
    session: { url: `http://127.0.0.1:${server.port}`, token: 'tok', email: null },
    send: (text: string) => {
      for (const stream of streams) stream.enqueue(new TextEncoder().encode(text))
    },
    stop: () => server.stop(true),
  }
}

const until = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !ready(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('SsePullRequestPort pr-event frames', () => {
  const ports: SsePullRequestPort[] = []
  const servers: { stop: () => void }[] = []
  afterEach(() => {
    for (const port of ports.splice(0)) port.dispose()
    for (const server of servers.splice(0)) server.stop()
  })

  const start = async (args: { onPrEvent: (frame: PrEventFrame) => void; warnings?: string[] }) => {
    const api = serve()
    servers.push(api)
    const port = new SsePullRequestPort({
      session: api.session,
      clientVersion: 'test',
      onReading: () => {},
      onPrEvent: args.onPrEvent,
      log: {
        port: {
          warn: ({ message }: { message: string }) => void args.warnings?.push(message),
          info: () => {},
        } as unknown as LogPort,
      },
    })
    ports.push(port)
    await port.read({ checkout: CHECKOUT })
    await until(() => true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return api
  }

  it('delivers a parsed pr-event frame to onPrEvent', async () => {
    const frames: PrEventFrame[] = []
    const api = await start({ onPrEvent: (frame) => frames.push(frame) })

    api.send(eventChunk(goodFrame))
    await until(() => frames.length > 0)

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ id: 'evt_1', kind: 'comment', prNumber: 42 })
  })

  it('warns on a malformed frame and keeps delivering the next one', async () => {
    const frames: PrEventFrame[] = []
    const warnings: string[] = []
    const api = await start({ onPrEvent: (frame) => frames.push(frame), warnings })

    api.send(eventChunk({ id: '', kind: 'nope' }))
    api.send(eventChunk({ ...goodFrame, id: 'evt_bad', payload: {} }))
    api.send(eventChunk({ ...goodFrame, id: 'evt_2' }))
    await until(() => frames.length > 0)

    expect(frames.map((frame) => frame.id)).toEqual(['evt_2'])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('malformed pr-event')
  })

  it('survives a consumer that throws', async () => {
    const seen: string[] = []
    const warnings: string[] = []
    const api = await start({
      warnings,
      onPrEvent: (frame) => {
        seen.push(frame.id)
        if (frame.id === 'evt_1') throw new Error('boom')
      },
    })

    api.send(eventChunk(goodFrame))
    api.send(eventChunk({ ...goodFrame, id: 'evt_2' }))
    await until(() => seen.length === 2)

    expect(seen).toEqual(['evt_1', 'evt_2'])
    expect(warnings[0]).toContain('boom')
  })
})
