import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  GENESIS_HASH,
  chainEvents,
  chainHash,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { RecordResumeCache } from '../record-resume'

const AT = '2026-11-06T12:00:00.000Z'

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })
const answered = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const logOf = (args: { threadId: string; prefix: string }): RecordEvent[] =>
  chainEvents({
    threadId: toThreadId(args.threadId),
    runId: toRunId('run-1'),
    epoch: 1,
    at: AT,
    bodies: [
      said(`${args.prefix} one`),
      answered(`${args.prefix} two`),
      said(`${args.prefix} three`),
    ],
  })

const lastHead = (events: readonly RecordEvent[]): LogHead => {
  const last = events[events.length - 1]
  return last === undefined
    ? { seq: 0, hash: GENESIS_HASH }
    : { seq: last.seq, hash: chainHash(last) }
}

type ReadParams = { threadId: string; afterSeq: number }

const planeOf = (threads: ReadonlyMap<string, readonly RecordEvent[]>): ControlPlane => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  return new Proxy(plane, {
    get: (target, key, receiver) => {
      if (key === 'head') {
        return async (params: { threadId: string }) => lastHead(threads.get(params.threadId) ?? [])
      }
      if (key === 'readEvents') {
        return async (params: ReadParams) => ({
          events: (threads.get(params.threadId) ?? []).filter(
            (event) => event.seq > params.afterSeq,
          ),
        })
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

const loaded = (args: {
  plane: ControlPlane
  threadId: string
  resume: RecordResumeCache
}): Promise<RecordCache> =>
  RecordCache.load({ plane: args.plane, threadId: toThreadId(args.threadId), resume: args.resume })

const twoThreads = (): ControlPlane =>
  planeOf(
    new Map([
      ['thread-1', logOf({ threadId: 'thread-1', prefix: 'a' })],
      ['thread-2', logOf({ threadId: 'thread-2', prefix: 'b' })],
    ]),
  )

describe('RecordResumeCache', () => {
  it('hands a record out once', async () => {
    const plane = twoThreads()
    const resume = new RecordResumeCache()
    const cache = await loaded({ plane, threadId: 'thread-1', resume })

    expect(resume.take(toThreadId('thread-1'))).toBe(cache)
    expect(resume.take(toThreadId('thread-1'))).toBeUndefined()
  })

  it('evicts the oldest record past the byte budget', async () => {
    const plane = twoThreads()
    const measure = new RecordResumeCache()
    const first = await loaded({ plane, threadId: 'thread-1', resume: measure })
    const second = await loaded({ plane, threadId: 'thread-2', resume: measure })
    const resume = new RecordResumeCache({
      maxBytes: first.retainedBytes() + second.retainedBytes() - 1,
    })

    resume.keep(first)
    resume.keep(second)

    expect(resume.size()).toBe(1)
    expect(resume.take(toThreadId('thread-1'))).toBeUndefined()
    expect(resume.take(toThreadId('thread-2'))).toBe(second)
  })

  it('counts a repeated thread once and keeps it newest', async () => {
    const plane = twoThreads()
    const measure = new RecordResumeCache()
    const first = await loaded({ plane, threadId: 'thread-1', resume: measure })
    const second = await loaded({ plane, threadId: 'thread-2', resume: measure })
    const resume = new RecordResumeCache({
      maxBytes: first.retainedBytes() + second.retainedBytes() - 1,
    })

    resume.keep(second)
    resume.keep(first)
    resume.keep(first)

    expect(resume.size()).toBe(1)
    expect(resume.take(toThreadId('thread-2'))).toBeUndefined()
    expect(resume.take(toThreadId('thread-1'))).toBe(first)
  })

  it('refuses a record larger than the per-record limit', async () => {
    const plane = twoThreads()
    const measure = await loaded({ plane, threadId: 'thread-1', resume: new RecordResumeCache() })
    const resume = new RecordResumeCache({ maxRecordBytes: measure.retainedBytes() - 1 })

    const loadedAgain = await loaded({ plane, threadId: 'thread-1', resume })

    expect(resume.size()).toBe(0)
    expect(loadedAgain.eventsAfter(0)).toEqual(measure.eventsAfter(0))
  })
})
