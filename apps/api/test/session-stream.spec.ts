import { SESSION_STREAM } from '@dltech/atlas-agent-host/host/tokens'
import { createSessionStream } from '@dltech/atlas-agent-host'
import { sessionStreamFrameSchema, type SessionStreamFrame } from '@dltech/atlas-wire'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../src/_core/ports/session-verifier'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../src/_module/trpc/trpc-middleware.fixture'
import { SessionMiddleware } from '../src/_module/session/session.middleware'
import { SessionStreamRouter } from '../src/api/cloud/stream/session-stream.router'
import { DrainStateService } from '../src/api/platform/health/drain-state.service'

const TOKEN = 'session-token'
const USER = 'usr_1'
const SESSION = 'ses_1'
const EVENT = {
  id: 'evt_1',
  threadId: 'thr_1',
  seq: 1,
  runId: 'run_1',
  depth: 0,
  at: '2026-11-17T00:00:00.000Z',
  type: 'user-said',
  body: '{"type":"user-said","text":"hello"}',
}

const hostStream = () => {
  const stream = createSessionStream({
    users: { acquire: () => true, release: () => undefined },
    timers: {
      now: () => Date.now(),
      setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
      clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      random: () => 0.5,
    },
    eventTypes: ['user-said'],
    log: undefined,
  })
  stream.start({
    subscriptions: {
      open: (connection) => ({
        handle: (message) => {
          connection.send({
            type: 'events',
            id: message.id,
            events: [EVENT],
            head: { seq: 1, hash: 'hash-1' },
            live: true,
          })
        },
        drain: () => undefined,
        close: () => undefined,
      }),
    },
  })
  return stream
}

type Verified = { userId: string; sessionId: string; email: string }

const verifierOf = () => ({
  verify: async (request: {
    headers: { authorization?: string | undefined }
  }): Promise<Verified | null> =>
    request.headers.authorization === `Bearer ${TOKEN}`
      ? { userId: USER, sessionId: 'auth-1', email: 'user@test.local' }
      : null,
})

const followUrl = ({ base, input }: { base: string; input: unknown }): string =>
  `${base}/v1/trpc/sessionStream.follow?input=${encodeURIComponent(JSON.stringify(input))}`

const sseFrames = async (args: { base: string }): Promise<SessionStreamFrame[]> => {
  const response = await fetch(
    followUrl({ base: args.base, input: { sessionId: SESSION, afterSeq: 0 } }),
    {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(3_000),
    },
  )
  expect(response.status).toBe(200)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('the subscription has no stream body')
  const decoder = new TextDecoder()
  let raw = ''
  try {
    while (!raw.includes('"type":"events"')) {
      const chunk = await reader.read()
      if (chunk.done === true) break
      raw += decoder.decode(chunk.value, { stream: true })
    }
  } catch {
    raw += decoder.decode()
  }
  await reader.cancel().catch(() => undefined)
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .flatMap((line) => {
      const parsed = sessionStreamFrameSchema.safeParse(JSON.parse(line.slice(6)))
      return parsed.success ? [parsed.data] : []
    })
}

const appOf = (providers: Parameters<typeof createMiddlewareApp>[0]['providers']) =>
  createMiddlewareApp({ rateLimit: UNTHROTTLED_RATE_LIMIT, providers })

describe('sessionStream over a real http server', () => {
  let app: NestExpressApplication
  let base: string

  beforeAll(async () => {
    app = await appOf([
      SessionStreamRouter,
      SessionMiddleware,
      DrainStateService,
      { provide: SESSION_VERIFIER, useValue: verifierOf() },
      { provide: SESSION_STREAM, useValue: hostStream() },
    ])
    await app.listen(0)
    base = await app.getUrl()
  })

  afterAll(async () => {
    await app.close()
  })

  it('greets a signed in follower with ready and then a live event', async () => {
    const frames = await sseFrames({ base })

    expect(frames[0]?.type).toBe('ready')
    const events = frames[1]
    expect(events?.type === 'events' ? events.events.map((event) => event.seq) : []).toEqual([1])
    expect(events?.type === 'events' ? events.live : false).toBe(true)
  })

  it('refuses an unauthorized follower with an UNAUTHORIZED error event', async () => {
    const response = await fetch(followUrl({ base, input: { sessionId: SESSION } }), {
      headers: { accept: 'text/event-stream' },
      signal: AbortSignal.timeout(3_000),
    })
    const body = await response.text()

    expect(body).toContain('UNAUTHORIZED')
    expect(body).toContain('sessionStream.follow')
  })
})

describe('sessionStream without a mounted host', () => {
  let app: NestExpressApplication
  let base: string

  beforeAll(async () => {
    app = await appOf([
      SessionStreamRouter,
      SessionMiddleware,
      DrainStateService,
      { provide: SESSION_VERIFIER, useValue: verifierOf() },
    ])
    await app.listen(0)
    base = await app.getUrl()
  })

  afterAll(async () => {
    await app.close()
  })

  it('refuses the follow with an error event instead of a stream', async () => {
    const response = await fetch(followUrl({ base, input: { sessionId: SESSION } }), {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${TOKEN}` },
    })
    const body = await response.text()

    expect(body).toContain('serialized-error')
    expect(body).toContain('sessionStream.follow')
  })
})
