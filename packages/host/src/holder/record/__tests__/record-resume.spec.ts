import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { toThreadId } from '@dltech/atlas-core'

import { RecordCache } from '../record-cache'
import { RECORD_RESUME_LIMIT, RecordResumeCache } from '../record-resume'

const planeOf = (): ControlPlane =>
  new ControlPlane({
    store: new InMemoryControlStore({ clock: () => '2026-11-06T12:00:00.000Z' }),
  })

const cacheOf = (args: { plane: ControlPlane; threadId: string }): RecordCache =>
  new RecordCache({ plane: args.plane, threadId: toThreadId(args.threadId) })

describe('RecordResumeCache', () => {
  it('hands a record out once', () => {
    const plane = planeOf()
    const resume = new RecordResumeCache()
    const cache = cacheOf({ plane, threadId: 'thread-1' })

    resume.keep(cache)

    expect(resume.take(toThreadId('thread-1'))).toBe(cache)
    expect(resume.take(toThreadId('thread-1'))).toBeUndefined()
  })

  it('keeps only the most recent threads', () => {
    const plane = planeOf()
    const resume = new RecordResumeCache()
    for (let index = 0; index <= RECORD_RESUME_LIMIT; index += 1) {
      resume.keep(cacheOf({ plane, threadId: `thread-${index}` }))
    }

    expect(resume.size()).toBe(RECORD_RESUME_LIMIT)
    expect(resume.take(toThreadId('thread-0'))).toBeUndefined()
    expect(resume.take(toThreadId(`thread-${RECORD_RESUME_LIMIT}`))).toBeDefined()
  })

  it('counts a repeated thread once and keeps it newest', () => {
    const plane = planeOf()
    const resume = new RecordResumeCache()
    for (let index = 0; index <= RECORD_RESUME_LIMIT; index += 1) {
      resume.keep(cacheOf({ plane, threadId: `thread-${index}` }))
    }
    const older = cacheOf({ plane, threadId: 'thread-1' })
    resume.keep(cacheOf({ plane, threadId: 'thread-0' }))
    resume.keep(older)

    expect(resume.size()).toBe(RECORD_RESUME_LIMIT)
    expect(resume.take(toThreadId('thread-1'))).toBe(older)
    expect(resume.take(toThreadId('thread-2'))).toBeUndefined()
  })
})
