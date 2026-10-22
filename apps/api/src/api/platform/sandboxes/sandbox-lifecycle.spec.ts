import { ERuntimePhase } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'

import {
  sandboxStateOf,
  WAKE_CLAIM_TTL_MS,
  wakeableOf,
  type SandboxLifecycleColumns,
} from './sandbox-lifecycle'
import { ESandboxState } from './sandboxes.types'

const dateAgo = (ms: number): Date => new Date(Date.now() - ms)
const isoAgo = (ms: number): string => dateAgo(ms).toISOString()

const lifecycleRow = (args: {
  phase?: ERuntimePhase
  state?: string
  wakeClaim?: Date | null
  reportedAt?: string
}): SandboxLifecycleColumns => {
  if (args.phase === undefined) {
    return {
      threadId: 'thr-1',
      state: args.state ?? 'parked',
      runtimeCheckpoint: null,
      runtimeCheckpointRevision: null,
      wakeClaim: args.wakeClaim ?? null,
    }
  }
  const record = {
    threadId: 'thr-1',
    runtimeId: 'runtime-1',
    sandboxSessionId: 'ses-1',
    revision: 2,
    reportedAt: args.reportedAt ?? isoAgo(60_000),
    transcript: { head: 1, count: 1, digest: 'd'.repeat(64) },
    phase: args.phase,
  }
  const receipt = {
    version: 1,
    threadId: 'thr-1',
    sandboxSessionId: 'ses-1',
    resumeParent: true,
    checkpoint: { ...record, phase: ERuntimePhase.Updating },
  }
  return {
    threadId: 'thr-1',
    state: args.state ?? 'running',
    runtimeCheckpoint: args.phase === ERuntimePhase.Updating ? { ...record, receipt } : record,
    runtimeCheckpointRevision: 2,
    wakeClaim: args.wakeClaim ?? null,
  }
}

describe('sandboxStateOf', () => {
  it.each([
    [ERuntimePhase.Serving, ESandboxState.Running],
    [ERuntimePhase.Parking, ESandboxState.Parked],
    [ERuntimePhase.Parked, ESandboxState.Parked],
    [ERuntimePhase.Provisioning, ESandboxState.Resuming],
    [ERuntimePhase.Waking, ESandboxState.Resuming],
    [ERuntimePhase.Updating, ESandboxState.Resuming],
  ])('maps the mirrored %s phase to %s, whatever the legacy column says', (phase, expected) => {
    expect(sandboxStateOf(lifecycleRow({ phase, state: 'running' }))).toBe(expected)
    expect(sandboxStateOf(lifecycleRow({ phase, state: 'parked' }))).toBe(expected)
  })

  it('falls back to the legacy column when no record has been mirrored', () => {
    expect(sandboxStateOf(lifecycleRow({ state: 'running' }))).toBe(ESandboxState.Running)
    expect(sandboxStateOf(lifecycleRow({ state: 'resuming' }))).toBe(ESandboxState.Resuming)
    expect(sandboxStateOf(lifecycleRow({ state: 'garbage' }))).toBe(ESandboxState.Parked)
  })

  it('reads a parked row under a live wake claim as resuming', () => {
    const claimed = lifecycleRow({ phase: ERuntimePhase.Parked, wakeClaim: dateAgo(1_000) })
    expect(sandboxStateOf(claimed)).toBe(ESandboxState.Resuming)
  })

  it('lets a record reported after the claim supersede it', () => {
    const superseded = lifecycleRow({
      phase: ERuntimePhase.Parked,
      wakeClaim: dateAgo(5_000),
      reportedAt: isoAgo(1_000),
    })
    expect(sandboxStateOf(superseded)).toBe(ESandboxState.Parked)
  })

  it('expires a claim whose waker died mid-wake', () => {
    const stale = lifecycleRow({ phase: ERuntimePhase.Parked, wakeClaim: dateAgo(WAKE_CLAIM_TTL_MS + 1_000) })
    expect(sandboxStateOf(stale)).toBe(ESandboxState.Parked)
  })
})

describe('wakeableOf', () => {
  it('wakes only a parked, unclaimed sandbox', () => {
    expect(wakeableOf(lifecycleRow({ phase: ERuntimePhase.Parked }))).toBe(true)
    expect(wakeableOf(lifecycleRow({ phase: ERuntimePhase.Parking }))).toBe(false)
    expect(wakeableOf(lifecycleRow({ phase: ERuntimePhase.Serving }))).toBe(false)
    expect(wakeableOf(lifecycleRow({ phase: ERuntimePhase.Parked, wakeClaim: dateAgo(1_000) }))).toBe(false)
    expect(wakeableOf(lifecycleRow({ state: 'parked' }))).toBe(true)
  })
})
