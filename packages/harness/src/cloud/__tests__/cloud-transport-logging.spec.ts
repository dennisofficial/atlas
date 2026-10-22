import { describe, expect, it } from 'bun:test'

import { ELogSeverity, LogPort, toThreadId, type LogEntry } from '@dltech/atlas-core'

import { cloudRawRequest, cloudRequest, type TransportRetryLog } from '../cloud-transport'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

type Reply = { status: number; body?: unknown; retryAfter?: string; networkError?: boolean }

const harness = (args: { replies: readonly Reply[]; log?: TransportRetryLog }) => {
  let at = 0

  const fetchFn = (async (_input: unknown) => {
    const reply = args.replies[Math.min(at, args.replies.length - 1)]
    at += 1
    if (reply?.networkError === true) throw new Error('the connection was reset')
    return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply?.status ?? 200,
      headers: reply?.retryAfter === undefined ? {} : { 'retry-after': reply.retryAfter },
    })
  }) as typeof fetch

  const sleep = async (_ms: number): Promise<void> => undefined

  return { fetchFn, sleep }
}

describe('cloud transport operational log', () => {
  it('warns per retried status and goes quiet once a 2xx lands', async () => {
    const log = new CapturingLog()
    const { fetchFn, sleep } = harness({
      replies: [{ status: 429 }, { status: 503 }, { status: 200, body: [] }],
    })

    await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      sleep,
      randomFn: () => 1,
      log: { port: log },
    })

    expect(log.entries).toHaveLength(2)
    for (const entry of log.entries) {
      expect(entry.severity).toBe(ELogSeverity.Warn)
      expect(entry.source).toBe('cloud.transport')
      expect(entry.data?.['method']).toBe('GET')
      expect(entry.data?.['path']).toBe('/v1/threads/thread-1/events')
      expect(entry.data).not.toHaveProperty('token')
    }
    expect(log.entries[0]?.data?.['cause']).toBe('status 429')
    expect(log.entries[0]?.data?.['attempt']).toBe(0)
    expect(log.entries[1]?.data?.['cause']).toBe('status 503')
    expect(log.entries[1]?.data?.['attempt']).toBe(1)
  })

  it('warns per retried network failure and errors on the final give-up', async () => {
    const log = new CapturingLog()
    const { fetchFn, sleep } = harness({ replies: [{ status: 200, networkError: true }] })

    const failure = await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      sleep,
      randomFn: () => 1,
      log: { port: log },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(log.entries).toHaveLength(4)
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(log.entries[0]?.data?.['cause']).toBe('network: the connection was reset')
    expect(log.entries[0]?.data?.['attempt']).toBe(0)
    expect(log.entries[3]?.severity).toBe(ELogSeverity.Error)
    expect(log.entries[3]?.data?.['attempt']).toBe(3)
  })

  it('errors on the final status give-up without a warn first', async () => {
    const log = new CapturingLog()
    const { fetchFn, sleep } = harness({ replies: [{ status: 429 }] })

    const failure = await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      sleep,
      randomFn: () => 1,
      log: { port: log },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(log.entries).toHaveLength(4)
    expect(log.entries.slice(0, 3).every((entry) => entry.severity === ELogSeverity.Warn)).toBe(true)
    expect(log.entries[3]?.severity).toBe(ELogSeverity.Error)
    expect(log.entries[3]?.data?.['cause']).toBe('status 429')
  })

  it('stays silent when no log is handed in', async () => {
    const { fetchFn, sleep } = harness({
      replies: [{ status: 429 }, { status: 200, body: [] }],
    })

    const answer = await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      sleep,
      randomFn: () => 1,
    })

    expect(answer).toEqual([])
  })

  it('warns on the raw path the same way', async () => {
    const log = new CapturingLog()
    const { fetchFn, sleep } = harness({
      replies: [{ status: 429 }, { status: 200, body: [] }],
    })

    await cloudRawRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/drives/drive-1/context',
      sleep,
      log: { port: log },
    })

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(log.entries[0]?.data?.['cause']).toBe('status 429')
  })

  it('routes the threadId onto the lines when one is given', async () => {
    const log = new CapturingLog()
    const { fetchFn, sleep } = harness({
      replies: [{ status: 429 }, { status: 200, body: [] }],
    })

    await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      sleep,
      randomFn: () => 1,
      log: { port: log, threadId: toThreadId('thread-1') },
    })

    expect(log.entries[0]?.threadId).toBe(toThreadId('thread-1'))
  })
})
