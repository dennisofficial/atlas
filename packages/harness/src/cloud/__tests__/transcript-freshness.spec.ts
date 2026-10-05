import { describe, expect, it } from 'bun:test'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { ECloudSandboxState } from '../sandbox-client'
import {
  cloudLifecycleOf,
  ECloudFreshness,
  ECloudSandboxLifecycle,
  EParkedResume,
  isTranscriptMuted,
  parkedResumeOf,
  transcriptFreshnessOf,
} from '../transcript-freshness'

const checkpoint = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: 'thread-1',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'session-a',
  revision: 3,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T00:00:00.000Z',
  transcript: { head: 42, count: 42, digest: 'a'.repeat(64) },
  ...overrides,
})

const applied = { head: 42, count: 42, digest: 'a'.repeat(64) }

const freshness = (args: {
  lifecycle?: ECloudSandboxLifecycle
  checkpoint?: RuntimeCheckpoint | null
  observedSandboxSessionId?: string
  applied?: { head: number; count: number; digest: string }
}) =>
  transcriptFreshnessOf({
    threadId: 'thread-1',
    lifecycle: args.lifecycle ?? ECloudSandboxLifecycle.Parked,
    checkpoint: args.checkpoint === undefined ? checkpoint() : args.checkpoint,
    observedSandboxSessionId: args.observedSandboxSessionId ?? 'session-a',
    applied: args.applied ?? applied,
  })

describe('transcriptFreshnessOf', () => {
  it('reads a parked checkpoint that matches the applied snapshot as synced', () => {
    expect(freshness({})).toBe(ECloudFreshness.Synced)
  })

  it('reads a parked checkpoint ahead of the applied snapshot as behind', () => {
    expect(
      freshness({ checkpoint: checkpoint({ transcript: { head: 43, count: 43, digest: 'b'.repeat(64) } }) }),
    ).toBe(ECloudFreshness.Behind)
  })

  it('reads a checkpoint from a sandbox session the provider never saw as unknown', () => {
    expect(freshness({ observedSandboxSessionId: 'session-b' })).toBe(ECloudFreshness.Unknown)
  })

  it('refuses to trust any checkpoint while the provider names no session', () => {
    expect(
      transcriptFreshnessOf({
        threadId: 'thread-1',
        lifecycle: ECloudSandboxLifecycle.Parked,
        checkpoint: checkpoint(),
        applied,
      }),
    ).toBe(ECloudFreshness.Unknown)
  })

  it('reads a running or stopped checkpoint phase as no proof either way', () => {
    for (const phase of [ERuntimePhase.Running, ERuntimePhase.Stopped]) {
      expect(freshness({ checkpoint: checkpoint({ phase }) })).toBe(ECloudFreshness.Unknown)
    }
  })

  it('never trusts a checkpoint while the sandbox itself is not parked', () => {
    for (const lifecycle of [
      ECloudSandboxLifecycle.Running,
      ECloudSandboxLifecycle.Stopped,
      ECloudSandboxLifecycle.Unknown,
    ]) {
      expect(freshness({ lifecycle })).toBe(ECloudFreshness.Unknown)
    }
  })

  it('refuses a checkpoint written for another thread', () => {
    expect(freshness({ checkpoint: checkpoint({ threadId: 'thread-2' }) })).toBe(
      ECloudFreshness.Unknown,
    )
  })

  it('stays unknown without a checkpoint or before any snapshot was applied', () => {
    expect(freshness({ checkpoint: null })).toBe(ECloudFreshness.Unknown)
    expect(
      transcriptFreshnessOf({
        threadId: 'thread-1',
        lifecycle: ECloudSandboxLifecycle.Parked,
        checkpoint: checkpoint(),
        observedSandboxSessionId: 'session-a',
      }),
    ).toBe(ECloudFreshness.Unknown)
  })

  it('reads a same-head rewind as a different transcript rather than synced', () => {
    expect(
      freshness({ checkpoint: checkpoint({ transcript: { head: 42, count: 42, digest: 'c'.repeat(64) } }) }),
    ).toBe(ECloudFreshness.Behind)
  })
})

describe('parkedResumeOf', () => {
  it('reads a missing record as unknown', () => {
    expect(parkedResumeOf({ record: null })).toBe(EParkedResume.Unknown)
  })

  it('reads a checkpoint that is not parked as unknown', () => {
    for (const phase of [ERuntimePhase.Running, ERuntimePhase.Stopped]) {
      expect(
        parkedResumeOf({ record: { checkpoint: checkpoint({ phase }), applied } }),
      ).toBe(EParkedResume.Unknown)
    }
  })

  it('reads a parked checkpoint with nothing applied yet as behind', () => {
    expect(
      parkedResumeOf({ record: { checkpoint: checkpoint(), applied: null } }),
    ).toBe(EParkedResume.Behind)
  })

  it('reads a parked checkpoint matching the applied snapshot as synced', () => {
    expect(
      parkedResumeOf({ record: { checkpoint: checkpoint(), applied } }),
    ).toBe(EParkedResume.Synced)
  })

  it('reads any head, count, or digest drift as behind', () => {
    const cases = [
      { head: 43, count: 42, digest: 'a'.repeat(64) },
      { head: 42, count: 43, digest: 'a'.repeat(64) },
      { head: 42, count: 42, digest: 'c'.repeat(64) },
    ]
    for (const drifted of cases) {
      expect(
        parkedResumeOf({
          record: { checkpoint: checkpoint({ transcript: drifted }), applied },
        }),
      ).toBe(EParkedResume.Behind)
    }
  })
})

describe('cloudLifecycleOf', () => {
  it('maps every sandbox state, with unknown staying unknown', () => {
    expect(cloudLifecycleOf(ECloudSandboxState.Parked)).toBe(ECloudSandboxLifecycle.Parked)
    expect(cloudLifecycleOf(ECloudSandboxState.Stopped)).toBe(ECloudSandboxLifecycle.Stopped)
    expect(cloudLifecycleOf(ECloudSandboxState.Unknown)).toBe(ECloudSandboxLifecycle.Unknown)
    expect(cloudLifecycleOf(ECloudSandboxState.Running)).toBe(ECloudSandboxLifecycle.Running)
    expect(cloudLifecycleOf(ECloudSandboxState.Resuming)).toBe(ECloudSandboxLifecycle.Running)
  })
})

describe('isTranscriptMuted', () => {
  it('does not mute an open socket whose transcript is proven synced', () => {
    expect(
      isTranscriptMuted({
        lifecycle: ECloudSandboxLifecycle.Parked,
        socketOpen: true,
        freshness: ECloudFreshness.Synced,
        tailIsParked: false,
      }),
    ).toBe(false)
  })

  it('keeps an open socket muted while a resync is pending — freshness behind', () => {
    expect(
      isTranscriptMuted({
        lifecycle: ECloudSandboxLifecycle.Running,
        socketOpen: true,
        freshness: ECloudFreshness.Behind,
        tailIsParked: false,
      }),
    ).toBe(true)
  })

  it('mutes an open socket whose freshness is unproven — only synced ungrays', () => {
    expect(
      isTranscriptMuted({
        lifecycle: ECloudSandboxLifecycle.Running,
        socketOpen: true,
        freshness: ECloudFreshness.Unknown,
        tailIsParked: false,
      }),
    ).toBe(true)
  })

  it('mutes a running sandbox whose socket is gone, synced or not', () => {
    for (const freshness of [ECloudFreshness.Synced, ECloudFreshness.Unknown]) {
      expect(
        isTranscriptMuted({
          lifecycle: ECloudSandboxLifecycle.Running,
          socketOpen: false,
          freshness,
          tailIsParked: false,
        }),
      ).toBe(true)
    }
  })

  it('unmutes a parked sandbox whose transcript tail is the parked marker', () => {
    expect(
      isTranscriptMuted({
        lifecycle: ECloudSandboxLifecycle.Parked,
        socketOpen: false,
        freshness: ECloudFreshness.Synced,
        tailIsParked: true,
      }),
    ).toBe(false)
  })

  it('mutes a parked sandbox whose transcript tail is not the parked marker, even when synced', () => {
    expect(
      isTranscriptMuted({
        lifecycle: ECloudSandboxLifecycle.Parked,
        socketOpen: false,
        freshness: ECloudFreshness.Synced,
        tailIsParked: false,
      }),
    ).toBe(true)
  })

  it('mutes a parked sandbox whose transcript is unproven even when the tail carries the marker', () => {
    for (const freshness of [ECloudFreshness.Behind, ECloudFreshness.Unknown]) {
      for (const tailIsParked of [false, true]) {
        expect(
          isTranscriptMuted({
            lifecycle: ECloudSandboxLifecycle.Parked,
            socketOpen: false,
            freshness,
            tailIsParked,
          }),
        ).toBe(true)
      }
    }
  })

  it('mutes a stopped or unknown sandbox regardless', () => {
    for (const lifecycle of [ECloudSandboxLifecycle.Stopped, ECloudSandboxLifecycle.Unknown]) {
      expect(
        isTranscriptMuted({ lifecycle, socketOpen: false, freshness: ECloudFreshness.Synced, tailIsParked: false }),
      ).toBe(true)
    }
  })
})
