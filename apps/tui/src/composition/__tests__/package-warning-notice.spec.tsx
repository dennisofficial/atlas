import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
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

function emitWarning(text: string): void {
  const { log } = captureWarnings()
  const redirect = installOutputRedirect({ log })
  try {
    redirect.enableNotices()
    console.warn(text)
  } finally {
    redirect.restore()
  }
}

beforeEach(() => dismissNotice())
afterEach(() => dismissNotice())

describe('package warning notices', () => {
  it('shows the SDK model and cause instead of a hidden-warning counter', () => {
    const { log, entries } = captureWarnings()
    const redirect = installOutputRedirect({ log })
    const cause = 'AI SDK Warning (openai / gpt-6.1-sol): Non-OpenAI reasoning parts are not supported.'
    const payload = 'private reasoning '.repeat(40)
    try {
      redirect.enableNotices()
      process.emitWarning(`${cause} Skipping reasoning part: {"text":"${payload}"}`, { type: 'Warning' })
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
    emitWarning('a package is unhappy')
    const notice = currentNotices()[0]
    expect(notice).toBeDefined()
    if (notice === undefined) return

    expect(notice.ttlMs).toBe(15_000)
    tickNotices({ nowMs: notice.issuedAtMs + 14_999 })
    expect(currentNotices()).toHaveLength(1)
    tickNotices({ nowMs: notice.issuedAtMs + 15_000 })
    expect(currentNotices()).toHaveLength(0)
  })

  it('updates a repeat in place while preserving a distinct warning', () => {
    const { log, entries } = captureWarnings()
    const redirect = installOutputRedirect({ log })
    try {
      redirect.enableNotices()
      for (let index = 0; index < 20; index += 1) console.warn('repeated warning')
      console.warn('another warning')
    } finally {
      redirect.restore()
    }

    expect(entries).toHaveLength(21)
    expect(currentNotices()).toHaveLength(2)
    expect(currentNotices()[0]?.text).toContain('repeated warning')
    expect(currentNotices()[0]?.text).toContain('20 occurrences')
    expect(currentNotices()[1]?.text).toContain('another warning')
  })

  it('does not reuse a repeat count after that warning has expired', () => {
    const { log } = captureWarnings()
    const redirect = installOutputRedirect({ log })
    try {
      redirect.enableNotices()
      console.warn('repeated warning')
      console.warn('repeated warning')
      dismissNotice()
      console.warn('repeated warning')
    } finally {
      redirect.restore()
    }
    expect(currentNotices()[0]?.text).not.toContain('occurrences')
  })

  it('trims generic warnings without trimming their diagnostic log preview', () => {
    const { log, entries } = captureWarnings()
    const redirect = installOutputRedirect({ log })
    const text = 'x'.repeat(1_500)
    try {
      redirect.enableNotices()
      console.warn(text)
    } finally {
      redirect.restore()
    }
    expect(currentNotices()[0]?.text).toContain(`${'x'.repeat(SINK_NOTICE_TEXT_LIMIT)}…`)
    expect(currentNotices()[0]?.text.length).toBeLessThan(300)
    expect(entries[0]?.message).toBe(text)
  })

  it('renders a readable warning in narrow and wide terminals after two seconds', async () => {
    emitWarning('OpenAI Responses (gpt-6.1-sol): omitted 2 incompatible historical reasoning parts; answers and tool calls are unchanged.')
    const notice = currentNotices()[0]
    if (notice === undefined) throw new Error('the warning was not posted')
    tickNotices({ nowMs: notice.issuedAtMs + 2_001 })

    for (const width of [40, 100]) {
      const frame = await frameOf(<NoticeStack width={width} />, width)
      expect(frame).toContain('⚠ package warning:')
      expect(frame).toContain('gpt-6.1-sol')
      expect(frame).toContain('see logs.jsonl')
      expect(frame.split('\n').filter((row) => row.trim().length > 0).length).toBeLessThan(9)
    }
  })
})
