import { describe, expect, it } from 'bun:test'

import type { CheckIdentity } from '../check-identity'
import {
  checkReconcileEffectsOf,
  checksIdentityOf,
  compareCheckAttempts,
  derivedChecksOf,
  latestCheckAttempts,
} from '../check-identity'
import { ECheckOutcome, EChecksState } from '../checks'
import { ECheckSource, type CheckRunSample, type StatusSample } from '../pr-observation'

const HEAD = '5778f502a0e59405ebbe1a67518ffe791b194b56'

const runSample = (overrides: Partial<CheckRunSample> = {}): CheckRunSample => ({
  source: ECheckSource.Run,
  id: 101,
  name: 'fails',
  appSlug: 'github-actions',
  headSha: HEAD,
  status: 'completed',
  conclusion: 'failure',
  startedAt: '2026-11-18T21:03:47Z',
  completedAt: '2026-11-18T21:03:51Z',
  ...overrides,
})

const statusSample = (overrides: Partial<StatusSample> = {}): StatusSample => ({
  source: ECheckSource.Status,
  id: 59301135945,
  context: 'probe',
  state: 'pending',
  headSha: HEAD,
  createdAt: '2026-11-18T21:03:45Z',
  ...overrides,
})

const identityOf = (overrides: Partial<CheckRunSample>): CheckIdentity =>
  checksIdentityOf({ sample: runSample(overrides) })

describe('checksIdentityOf', () => {
  it('keys a check run by its id', () => {
    const identity = identityOf({})

    expect(identity.checkKey).toBe('run:101')
    expect(identity.name).toBe('fails')
    expect(identity.outcome).toBe(ECheckOutcome.Failed)
    expect(identity.sourceId).toBe('101')
    expect(identity.sourceCreatedAt).toBe('2026-11-18T21:03:51Z')
  })

  it('keys a status by its context', () => {
    const identity = checksIdentityOf({ sample: statusSample() })

    expect(identity.checkKey).toBe('status:probe')
    expect(identity.name).toBe('probe')
    expect(identity.outcome).toBe(ECheckOutcome.Running)
    expect(identity.sourceCreatedAt).toBe('2026-11-18T21:03:45Z')
  })
})

describe('compareCheckAttempts', () => {
  it('orders re-run attempts by run id', () => {
    const first = identityOf({ id: 101 })
    const second = identityOf({ id: 202 })

    expect(compareCheckAttempts({ a: second, b: first })).toBeGreaterThan(0)
    expect(compareCheckAttempts({ a: first, b: second })).toBeLessThan(0)
  })

  it('ranks a higher id above an earlier started_at on a re-created sibling', () => {
    const rerun = identityOf({ id: 202, startedAt: '2026-11-18T21:01:51Z', completedAt: null })
    const recreatedSibling = identityOf({
      id: 303,
      startedAt: '2026-11-18T21:01:52Z',
      completedAt: '2026-11-18T21:01:57Z',
    })

    expect(compareCheckAttempts({ a: recreatedSibling, b: rerun })).toBeGreaterThan(0)
    expect(latestCheckAttempts({ attempts: [rerun, recreatedSibling] })).toEqual([recreatedSibling])
  })

  it('ranks a completed observation above a created one for the same id', () => {
    const created = identityOf({
      id: 505,
      status: 'queued',
      conclusion: null,
      startedAt: '2026-11-18T21:06:50Z',
      completedAt: null,
    })
    const completed = identityOf({
      id: 505,
      status: 'completed',
      conclusion: 'failure',
      startedAt: '2026-11-18T21:06:47Z',
      completedAt: '2026-11-18T21:06:52Z',
    })

    expect(compareCheckAttempts({ a: completed, b: created })).toBeGreaterThan(0)
    expect(latestCheckAttempts({ attempts: [created, completed] })).toEqual([completed])
    expect(latestCheckAttempts({ attempts: [completed, created] })).toEqual([completed])
  })

  it('orders statuses by created_at and then by id', () => {
    const early = checksIdentityOf({
      sample: statusSample({ id: 9, createdAt: '2026-11-18T21:03:45Z' }),
    })
    const late = checksIdentityOf({
      sample: statusSample({ id: 1, createdAt: '2026-11-18T21:03:46Z' }),
    })
    const sameMoment = checksIdentityOf({
      sample: statusSample({ id: 59301136990, createdAt: '2026-11-18T21:03:45Z' }),
    })

    expect(compareCheckAttempts({ a: late, b: early })).toBeGreaterThan(0)
    expect(compareCheckAttempts({ a: sameMoment, b: early })).toBeGreaterThan(0)
  })
})

describe('derivedChecksOf', () => {
  it('counts one check per name and keeps the newest attempt', () => {
    const attempts = [identityOf({ id: 101 }), identityOf({ id: 202, conclusion: 'success' })]
    const derived = derivedChecksOf({ attempts, headSha: HEAD, requiredContexts: ['probe'] })

    expect(latestCheckAttempts({ attempts })).toHaveLength(1)
    expect(derived).toMatchObject({
      passed: 1,
      failed: 0,
      running: 0,
      rollup: EChecksState.Passing,
      requiredContexts: ['probe'],
    })
  })

  it('tallies the newest queued attempt as running', () => {
    const derived = derivedChecksOf({
      attempts: [
        identityOf({ id: 101 }),
        identityOf({ id: 202, conclusion: 'success' }),
        identityOf({
          id: 303,
          status: 'queued',
          conclusion: null,
          startedAt: '2026-11-18T21:04:10Z',
          completedAt: null,
        }),
      ],
      headSha: HEAD,
      requiredContexts: [],
    })

    expect(derived).toMatchObject({
      running: 1,
      passed: 0,
      failed: 0,
      rollup: EChecksState.Running,
    })
  })

  it('groups by name and app slug together', () => {
    const attempts = [identityOf({ id: 101 }), identityOf({ id: 202, appSlug: 'other-app' })]

    expect(latestCheckAttempts({ attempts })).toHaveLength(2)
  })

  it('reports no rollup when nothing is recorded for the head', () => {
    expect(derivedChecksOf({ attempts: [], headSha: HEAD, requiredContexts: [] }).rollup).toBeNull()
  })
})

describe('checkReconcileEffectsOf', () => {
  it('asks for a reconcile when a name carries a second attempt id', () => {
    const effects = checkReconcileEffectsOf({
      attempts: [identityOf({ id: 101 }), identityOf({ id: 202 })],
      headSha: HEAD,
      repoFullName: 'dennisofficial/atlas-payload-probe',
    })

    expect(effects).toEqual([
      {
        kind: 'reconcile-checks',
        headSha: HEAD,
        repoFullName: 'dennisofficial/atlas-payload-probe',
      },
    ])
  })

  it('asks for nothing when the deliveries only repeat one attempt id', () => {
    const effects = checkReconcileEffectsOf({
      attempts: [
        identityOf({ id: 505, status: 'queued', conclusion: null, completedAt: null }),
        identityOf({ id: 505 }),
      ],
      headSha: HEAD,
      repoFullName: 'dennisofficial/atlas-payload-probe',
    })

    expect(effects).toEqual([])
  })
})
