import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import type { ControlSessionDigest } from '../src/port'
import { fallbackTitleOf, NAMING_WINDOW_MS, sessionSummaryOf } from '../src/session-summary'

const POSTED = '2026-11-06T12:00:00.000Z'
const postedMs = Date.parse(POSTED)

const digest = (patch: Partial<ControlSessionDigest> = {}): ControlSessionDigest => ({
  sessionId: 's-1',
  userId: 'u-1',
  projectId: 'p-1',
  title: null,
  mainThreadId: 't-1',
  createdAt: '2026-11-06T11:59:00.000Z',
  archivedAt: null,
  deletedAt: null,
  modelRef: 'anthropic/claude-haiku-4-5',
  modelEffort: 'medium',
  modelFast: false,
  sandboxProvider: 'vercel',
  credentialSource: 'byok',
  sandboxInstanceId: null,
  sandboxStatus: null,
  sandboxStatusAt: null,
  sandboxStatusReason: null,
  spawnedBySessionId: null,
  nested: true,
  podSessionId: null,
  podDesiredVcpus: null,
  podDesiredMemoryGb: null,
  podDesiredDiskGb: null,
  podSizeGeneration: 0,
  podActualVcpus: null,
  podActualMemoryGb: null,
  podAppliedGeneration: null,
  podResizeError: null,
  podWaitingSince: null,
  podParkedAt: null,
  podParkError: null,
  routineId: null,
  lastEventAt: null,
  lastAssistantSeq: 0,
  headSeq: 0,
  lastTurn: null,
  readSeq: null,
  firstMessageText: 'Make the sidebar push session titles instead of polling them',
  firstMessageAt: POSTED,
  view: null,
  ...patch,
})

describe('sessionSummaryOf', () => {
  it('reports naming with no title inside the window', () => {
    const summary = sessionSummaryOf({ digest: digest(), now: postedMs + 1000 })
    expect(summary).toMatchObject({ title: null, naming: true })
  })

  it('falls back to the first message once the window passes', () => {
    const summary = sessionSummaryOf({ digest: digest(), now: postedMs + NAMING_WINDOW_MS })
    expect(summary).toMatchObject({ title: 'Make the sidebar push session titles…', naming: false })
  })

  it('shows a stored title and never names', () => {
    const summary = sessionSummaryOf({ digest: digest({ title: 'Pushed List' }), now: postedMs })
    expect(summary).toMatchObject({ title: 'Pushed List', naming: false })
  })

  it('has no title and is not naming before the first message', () => {
    const summary = sessionSummaryOf({
      digest: digest({ firstMessageText: null, firstMessageAt: null }),
      now: postedMs,
    })
    expect(summary).toMatchObject({ title: null, naming: false })
  })

  it('carries the sandbox status the digest exposes', () => {
    const sandbox = { status: ESandboxStatus.Sleeping, at: POSTED }
    const summary = sessionSummaryOf({
      digest: digest({
        view: {
          status: { state: ESessionStatus.Idle },
          primaryBranch: null,
          pullRequest: null,
          sandbox,
        },
      }),
      now: postedMs,
    })

    expect(summary.sandbox).toEqual(sandbox)
    expect(sessionSummaryOf({ digest: digest(), now: postedMs }).sandbox).toBeUndefined()
  })

  it('carries the assistant seq and read cursor', () => {
    const summary = sessionSummaryOf({
      digest: digest({ lastAssistantSeq: 12, readSeq: 9 }),
      now: 0,
    })
    expect(summary).toMatchObject({ lastAssistantSeq: 12, readSeq: 9 })
    expect(sessionSummaryOf({ digest: digest(), now: 0 })).toMatchObject({
      lastAssistantSeq: 0,
      readSeq: null,
    })
  })

  it('updates at the last event, else creation', () => {
    expect(sessionSummaryOf({ digest: digest(), now: 0 }).updatedAt).toBe(digest().createdAt)
    const touched = digest({ lastEventAt: '2026-11-06T12:05:00.000Z' })
    expect(sessionSummaryOf({ digest: touched, now: 0 }).updatedAt).toBe(touched.lastEventAt ?? '')
  })
})

describe('fallbackTitleOf', () => {
  it('keeps short text, flattens whitespace, and drops blanks', () => {
    expect(fallbackTitleOf('  fix\n the   build ')).toBe('fix the build')
    expect(fallbackTitleOf('   ')).toBeNull()
  })

  it('cuts a word with no spaces at the limit', () => {
    expect(fallbackTitleOf('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`)
  })
})
