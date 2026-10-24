import { describe, expect, it } from 'bun:test'

import { ELogSeverity, LogPort, toThreadId, type LogEntry } from '@dltech/atlas-core'

import { createRetryingFetch } from '../api-trpc-client'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

type Reply = { status: number; networkError?: boolean }

const scripted = (replies: readonly Reply[]): typeof fetch => {
  let at = 0
  return Object.assign(
    async () => {
      const reply = replies[Math.min(at, replies.length - 1)]
      at += 1
      if (reply?.networkError === true) throw new Error('the connection was reset')
      return new Response('{}', { status: reply?.status ?? 200 })
    },
    { preconnect: fetch.preconnect },
  )
}

const QUERY = 'https://cloud.test/v1/trpc/threads.list'
const instant = async (_ms: number): Promise<void> => undefined

describe('retrying fetch operational log', () => {
  it('warns per retried status and goes quiet once a 2xx lands', async () => {
    const log = new CapturingLog()
    const retrying = createRetryingFetch({
      fetchFn: scripted([{ status: 429 }, { status: 503 }, { status: 200 }]),
      log: { port: log },
      sleep: instant,
      randomFn: () => 1,
    })

    await retrying(QUERY)

    expect(log.entries).toHaveLength(2)
    for (const entry of log.entries) {
      expect(entry.severity).toBe(ELogSeverity.Warn)
      expect(entry.source).toBe('cloud.transport')
      expect(entry.data?.['method']).toBe('GET')
      expect(entry.data?.['path']).toBe('/v1/trpc/threads.list')
      expect(entry.data).not.toHaveProperty('token')
    }
    expect(log.entries[0]?.data?.['cause']).toBe('status 429')
    expect(log.entries[1]?.data?.['cause']).toBe('status 503')
    expect(log.entries[1]?.data?.['attempt']).toBe(1)
  })

  it('warns per retried network failure and errors on the final give-up', async () => {
    const log = new CapturingLog()
    const retrying = createRetryingFetch({
      fetchFn: scripted([{ status: 200, networkError: true }]),
      log: { port: log },
      sleep: instant,
      randomFn: () => 1,
    })

    const failure = await retrying(QUERY).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(log.entries).toHaveLength(4)
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(log.entries[0]?.data?.['cause']).toBe('network: the connection was reset')
    expect(log.entries[3]?.severity).toBe(ELogSeverity.Error)
    expect(log.entries[3]?.data?.['attempt']).toBe(3)
  })

  it('errors on the final status give-up after warning on each retry', async () => {
    const log = new CapturingLog()
    const retrying = createRetryingFetch({
      fetchFn: scripted([{ status: 429 }]),
      log: { port: log },
      sleep: instant,
      randomFn: () => 1,
    })

    const response = await retrying(QUERY)

    expect(response.status).toBe(429)
    expect(log.entries).toHaveLength(4)
    expect(log.entries.slice(0, 3).every((entry) => entry.severity === ELogSeverity.Warn)).toBe(
      true,
    )
    expect(log.entries[3]?.severity).toBe(ELogSeverity.Error)
    expect(log.entries[3]?.data?.['cause']).toBe('status 429')
  })

  it('stays silent when no log is handed in', async () => {
    const retrying = createRetryingFetch({
      fetchFn: scripted([{ status: 429 }, { status: 200 }]),
      sleep: instant,
      randomFn: () => 1,
    })

    expect((await retrying(QUERY)).status).toBe(200)
  })

  it('routes the threadId onto the lines when one is given', async () => {
    const log = new CapturingLog()
    const retrying = createRetryingFetch({
      fetchFn: scripted([{ status: 429 }, { status: 200 }]),
      log: { port: log, threadId: toThreadId('thread-1') },
      sleep: instant,
      randomFn: () => 1,
    })

    await retrying(QUERY)

    expect(log.entries[0]?.threadId).toBe(toThreadId('thread-1'))
  })
})
