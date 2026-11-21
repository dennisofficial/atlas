import { describe, expect, it } from 'bun:test'

import {
  EEffort,
  EModelFallbackReason,
  INBOX_KIND_EVENT,
  inboxEventOf,
  type ModelChoice,
} from '@dltech/atlas-core'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import { EFastRefusal } from '../../model/providers/fast-fallback'
import { fastRefusalHandler, type FastRefusalSessions } from '../fast-refusal'

const CHOICE: ModelChoice = {
  ref: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
  effort: EEffort.High,
  fast: true,
}

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const sessionsOf = (args: { modelFast: boolean; failWrite?: boolean }) => {
  const modelAsks: {
    ref?: string | undefined
    effort?: string | undefined
    fast?: boolean | undefined
  }[] = []
  const posts: { kind: string; payload: string }[] = []
  const sessions: FastRefusalSessions = {
    readSession: async () => ({ modelFast: args.modelFast }),
    setSessionModel: async ({ ask }) => {
      if (args.failWrite === true) throw new Error('the control plane is down')
      modelAsks.push(ask)
      return {}
    },
    post: async ({ kind, payload }) => {
      posts.push({ kind, payload })
      return { inboxId: 1 }
    },
  }
  return { sessions, modelAsks, posts }
}

const handlerOf = (args: { sessions: FastRefusalSessions; log?: LogPort | undefined }) =>
  fastRefusalHandler({
    sessions: args.sessions,
    sessionId: 'ses-1',
    choice: () => CHOICE,
    log: args.log,
  })

describe('fastRefusalHandler', () => {
  it('turns fast mode off and posts a visible notice when credits are required', async () => {
    const plane = sessionsOf({ modelFast: true })
    const log = new RecordingLog()

    await handlerOf({ sessions: plane.sessions, log })({
      kind: EFastRefusal.CreditsRequired,
      status: 429,
      message: 'Usage credits are required for fast mode.',
    })

    expect(plane.modelAsks).toEqual([
      { ref: 'anthropic/claude-opus-5-5', effort: EEffort.High, fast: false },
    ])
    expect(plane.posts).toHaveLength(1)
    expect(plane.posts[0]?.kind).toBe(INBOX_KIND_EVENT)
    const read = inboxEventOf(plane.posts[0]?.payload ?? '')
    expect(read.ok).toBe(true)
    expect(read.ok ? read.event : undefined).toMatchObject({
      type: 'model-fell-back',
      role: 'main',
      reason: EModelFallbackReason.FastCreditsRequired,
    })
    expect(log.entries.map((entry) => entry.source)).toEqual(['model.fast-refused'])
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
  })

  it('leaves a session already at standard speed alone', async () => {
    const plane = sessionsOf({ modelFast: false })
    const log = new RecordingLog()

    await handlerOf({ sessions: plane.sessions, log })({
      kind: EFastRefusal.CreditsRequired,
      message: 'Usage credits are required for fast mode.',
    })

    expect(plane.modelAsks).toEqual([])
    expect(plane.posts).toEqual([])
    expect(log.entries).toEqual([])
  })

  it('keeps fast mode after a bare rate limit and only logs it', async () => {
    const plane = sessionsOf({ modelFast: true })
    const log = new RecordingLog()

    await handlerOf({ sessions: plane.sessions, log })({
      kind: EFastRefusal.RateLimited,
      status: 529,
      message: 'Overloaded',
    })

    expect(plane.modelAsks).toEqual([])
    expect(plane.posts).toEqual([])
    expect(log.entries[0]).toMatchObject({
      severity: ELogSeverity.Warn,
      source: 'model.fast-refused',
      data: { kind: EFastRefusal.RateLimited, status: 529 },
    })
  })

  it('logs a failed write instead of failing the turn', async () => {
    const plane = sessionsOf({ modelFast: true, failWrite: true })
    const log = new RecordingLog()

    await handlerOf({ sessions: plane.sessions, log })({
      kind: EFastRefusal.CreditsRequired,
      message: 'Usage credits are required for fast mode.',
    })

    expect(log.entries[0]).toMatchObject({
      severity: ELogSeverity.Error,
      source: 'model.fast-refused',
      error: 'the control plane is down',
    })
  })
})
