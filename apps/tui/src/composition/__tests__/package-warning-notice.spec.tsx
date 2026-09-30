import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import React from 'react'

import { type LogEntry, SINK_NOTICE_TEXT_LIMIT } from '@dltech/atlas-core'
import { JsonlLog, registryFor, SystemClock } from '@dltech/atlas-harness'
import { NoticeStack } from '../../ui/components/notice-stack'
import { currentNotices, dismissNotice, tickNotices } from '../../ui/notice-store'
import { frameOf } from '../../ui/__tests__/transcript-fixture'
import { installOutputRedirect } from '../output-redirect'

function captureWarnings(): { log: JsonlLog; entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const home = process.env.ATLAS_HOME ?? '/tmp'
  const log = new JsonlLog({ home, registry: registryFor({ home }), clock: new SystemClock() })
  log.record = (entry: LogEntry) => entries.push(entry)
  return { log, entries }
}

function activeRedirect(log: JsonlLog): ReturnType<typeof installOutputRedirect> {
  const redirect = installOutputRedirect({ log })
  redirect.enableNotices()
  return redirect
}

beforeEach(() => {
  dismissNotice()
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
  dismissNotice()
})

const FLUSH_WAIT_MS = 400

describe('package warning notices', () => {
  it('shows the SDK model and cause instead of a hidden-warning counter', () => {
    const { log, entries } = captureWarnings()
    const redirect = activeRedirect(log)
    const cause = 'AI SDK Warning (openai / gpt-6.1-sol): Non-OpenAI reasoning parts are not supported.'
    const payload = 'private reasoning '.repeat(40)
    try {
      process.emitWarning(`${cause} Skipping reasoning part: {"text":"${payload}"}`, { type: 'Warning' })
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }

    const notice = currentNotices()[0]
    expect(notice?.text).toContain(cause)
    expect(notice?.text).toContain('see logs.jsonl')
    expect(notice?.text).not.toContain('hidden')
    expect(notice?.text).not.toContain(payload)
    expect(entries[0]?.message).toContain(payload)
  })

  it('keeps the warning for fifteen seconds, regardless of the default notice duration', () => {
    const { log } = captureWarnings()
    const redirect = activeRedirect(log)
    try {
      console.warn('a package is unhappy')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }
    const notice = currentNotices()[0]
    if (notice === undefined) throw new Error('the warning was not posted')

    expect(notice.ttlMs).toBe(15_000)
    tickNotices({ nowMs: notice.issuedAtMs + 14_999 })
    expect(currentNotices()).toHaveLength(1)
    tickNotices({ nowMs: notice.issuedAtMs + 15_000 })
    expect(currentNotices()).toHaveLength(0)
  })

  it('updates a repeat in place while preserving a distinct warning', () => {
    const { log, entries } = captureWarnings()
    const redirect = activeRedirect(log)
    try {
      for (let index = 0; index < 20; index += 1) console.warn('repeated warning')
      console.warn('another warning')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }

    expect(entries).toHaveLength(21)
    expect(currentNotices()).toHaveLength(2)
    expect(currentNotices()[0]?.text).toContain('repeated warning')
    expect(currentNotices()[0]?.text).toContain('20 occurrences')
    expect(currentNotices()[1]?.text).toContain('another warning')
  })

  it('groups warnings that differ only in the reasoning payload', () => {
    const { log } = captureWarnings()
    const redirect = activeRedirect(log)
    const head = 'AI SDK Warning (openai / gpt-6.1-sol): Non-OpenAI reasoning parts are not supported. Skipping reasoning part:'
    try {
      process.emitWarning(`${head} {"text":"first thought"}`, { type: 'Warning' })
      process.emitWarning(`${head} {"text":"second thought"}`, { type: 'Warning' })
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }

    expect(currentNotices()).toHaveLength(1)
    expect(currentNotices()[0]?.text).toContain('(2 occurrences)')
    expect(currentNotices()[0]?.text).not.toContain('first thought')
    expect(currentNotices()[0]?.text).not.toContain('second thought')
  })

  it('does not reuse a repeat count after that warning has expired', () => {
    const { log } = captureWarnings()
    const redirect = activeRedirect(log)
    try {
      console.warn('repeated warning')
      console.warn('repeated warning')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
      dismissNotice()
      console.warn('repeated warning')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }
    expect(currentNotices()[0]?.text).not.toContain('occurrences')
  })

  it('trims generic warnings without trimming their diagnostic log preview', () => {
    const { log, entries } = captureWarnings()
    const redirect = activeRedirect(log)
    const text = 'x'.repeat(1_500)
    try {
      console.warn(text)
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }
    expect(currentNotices()[0]?.text).toContain(`${'x'.repeat(SINK_NOTICE_TEXT_LIMIT)}…`)
    expect(currentNotices()[0]?.text.length).toBeLessThan(300)
    expect(entries[0]?.message).toBe(text)
  })

  it('shows only the first line of a multiline stack', () => {
    const { log } = captureWarnings()
    const redirect = activeRedirect(log)
    try {
      console.warn(new Error('boom'))
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
    } finally {
      redirect.restore()
    }
    const notice = currentNotices()[0]
    expect(notice?.text).toContain('boom')
    expect(notice?.text).not.toContain('\n')
    expect(notice?.text).not.toContain('at Object')
  })

  it('lets the warning age out while repeats keep arriving', () => {
    const { log } = captureWarnings()
    const redirect = activeRedirect(log)
    try {
      console.warn('steady warning')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
      const first = currentNotices()[0]
      if (first === undefined) throw new Error('the warning was not posted')

      tickNotices({ nowMs: first.issuedAtMs + 15_000 })
      expect(currentNotices()).toHaveLength(0)

      console.warn('steady warning')
      jest.advanceTimersByTime(FLUSH_WAIT_MS)
      const repeated = currentNotices()[0]
      expect(repeated?.text).toContain('steady warning')
      expect(repeated?.text).not.toContain('occurrences')
    } finally {
      redirect.restore()
    }
  })
})
