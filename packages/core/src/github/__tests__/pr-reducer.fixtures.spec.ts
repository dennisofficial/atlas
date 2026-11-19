import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ECheckOutcome, EChecksState } from '../checks'
import {
  EPrSource,
  EPrState,
  checkSampleOfPayload,
  mergeabilitySampleOfPayload,
  pullSampleOfPayload,
  type PrObservation,
} from '../pr-observation'
import {
  checksIdentityOf,
  derivedChecksOf,
  foldPrObservations,
  latestCheckAttempts,
} from '../pr-reducer'

const payloadDir = fileURLToPath(
  new URL('../../../../../apps/api/src/api/cloud/github/__fixtures__/payloads/', import.meta.url),
)

function payloadOf(name: string): unknown {
  return JSON.parse(readFileSync(join(payloadDir, name), 'utf8'))
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('fixture did not map to a sample')

  return value
}

const fixtureNames = readdirSync(payloadDir)
  .filter((name) => name.endsWith('.json'))
  .sort()

const pullFixtures = fixtureNames
  .filter((name) => name.startsWith('pull-request-'))
  .map((name) => ({ name, sample: required(pullSampleOfPayload(payloadOf(name))) }))

const pullObservationOf = (sample: (typeof pullFixtures)[number]['sample']): PrObservation => ({
  kind: 'pull',
  source: EPrSource.WebhookPull,
  observedAt: '2026-11-18T21:06:00.000Z',
  sample,
})

const fixtureSample = (name: string) =>
  required(pullFixtures.find((fixture) => fixture.name === name)?.sample ?? null)

function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]

  return items.flatMap((item, index) =>
    permutationsOf([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  )
}

describe('pull request payloads', () => {
  it('map every pull fixture to a sample', () => {
    expect(pullFixtures.length).toBeGreaterThan(0)
    for (const fixture of pullFixtures) {
      expect(fixture.sample.repoFullName).toBe('dennisofficial/atlas-payload-probe')
      expect(fixture.sample.headSha.length).toBeGreaterThan(0)
      expect(fixture.sample.baseBranch.length).toBeGreaterThan(0)
    }
  })

  it('read a delayed opened delivery as the closed pull it already describes', () => {
    const sample = fixtureSample('pull-request-opened.json')

    expect(sample.prNumber).toBe(4)
    expect(sample.state).toBe(EPrState.Closed)
    expect(sample.pullUpdatedAt).toBe('2026-11-18T21:03:49Z')
    expect(sample.closedAt).toBe('2026-11-18T21:03:49Z')
    expect(sample.mergedAt).toBeNull()
    expect(sample.baseBranch).toBe('main')
    expect(sample.headSha).toBe('4b26d3e559172662b7567b8fc9c8992be2062691')
  })

  it('leave the opened mergeability sample unknown', () => {
    const sample = required(
      mergeabilitySampleOfPayload({
        observedAt: '2026-11-18T21:03:50.000Z',
        payload: payloadOf('pull-request-opened.json'),
      }),
    )

    expect(sample.mergeable).toBeNull()
    expect(sample.mergeClean).toBeNull()
    expect(sample.headSha).toBe('4b26d3e559172662b7567b8fc9c8992be2062691')
  })

  it('read the edited title sample as an older open pull', () => {
    const sample = fixtureSample('pull-request-edited-title.json')
    const mergeability = required(
      mergeabilitySampleOfPayload({
        observedAt: '2026-11-18T21:03:50.000Z',
        payload: payloadOf('pull-request-edited-title.json'),
      }),
    )

    expect(sample.state).toBe(EPrState.Open)
    expect(sample.pullUpdatedAt).toBe('2026-11-18T21:03:43Z')
    expect(sample.closedAt).toBeNull()
    expect(mergeability.mergeable).toBe(true)
    expect(mergeability.mergeClean).toBe(true)
  })

  it('read a merged close as merged with its merge timestamps', () => {
    const sample = fixtureSample('pull-request-closed-merged.json')
    const mergeability = required(
      mergeabilitySampleOfPayload({
        observedAt: '2026-11-18T21:06:40.000Z',
        payload: payloadOf('pull-request-closed-merged.json'),
      }),
    )

    expect(sample.state).toBe(EPrState.Merged)
    expect([sample.mergedAt, sample.closedAt, sample.pullUpdatedAt]).toEqual([
      '2026-11-18T21:06:36Z',
      '2026-11-18T21:06:36Z',
      '2026-11-18T21:06:36Z',
    ])
    expect(mergeability.mergeable).toBeNull()
  })

  it('agree across every arrival order of one pull request', () => {
    const byPull = new Map<string, PrObservation[]>()
    for (const fixture of pullFixtures) {
      const key = `${fixture.sample.repoFullName}#${fixture.sample.prNumber}`
      const observations = byPull.get(key) ?? []
      observations.push(pullObservationOf(fixture.sample))
      byPull.set(key, observations)
    }

    const repeated = [...byPull.values()].filter((observations) => observations.length > 1)
    expect(repeated.length).toBeGreaterThan(0)
    for (const observations of repeated) {
      const expected = foldPrObservations({ observations, state: null })
      for (const permutation of permutationsOf(observations)) {
        expect(foldPrObservations({ observations: permutation, state: null })).toEqual(expected)
      }
    }
  })

  it('break the same-second draft and ready-for-review tie towards the draft', () => {
    const draft = pullObservationOf(fixtureSample('pull-request-converted-to-draft.json'))
    const ready = pullObservationOf(fixtureSample('pull-request-ready-for-review.json'))
    const forward = foldPrObservations({ observations: [draft, ready], state: null })
    const reverse = foldPrObservations({ observations: [ready, draft], state: null })

    expect(forward.state?.pull?.pullUpdatedAt).toBe('2026-11-18T21:03:44Z')
    expect(forward.state?.pull?.state).toBe(EPrState.Draft)
    expect(reverse.state).toEqual(forward.state)
  })
})

describe('check payloads', () => {
  it('key a completed check run by its id and read run_attempt never', () => {
    const payload = payloadOf('check-run-completed.json') as { check_run: Record<string, unknown> }
    expect('run_attempt' in payload.check_run).toBe(false)

    const identity = checksIdentityOf({ sample: required(checkSampleOfPayload(payload)) })
    const rerun = checksIdentityOf({
      sample: required(
        checkSampleOfPayload({
          ...payload,
          check_run: { ...payload.check_run, run_attempt: 2 },
        }),
      ),
    })

    expect(identity.checkKey).toBe('run:135131269650')
    expect(identity.name).toBe('fails')
    expect(identity.appSlug).toBe('github-actions')
    expect(identity.outcome).toBe(ECheckOutcome.Failed)
    expect(identity.sourceId).toBe('135131269650')
    expect(identity.sourceCreatedAt).toBe('2026-11-18T21:03:51Z')
    expect(rerun).toEqual(identity)
  })

  it('read a check suite as a head address and not a check', () => {
    expect(checkSampleOfPayload(payloadOf('check-suite-completed.json'))).toBeNull()
  })

  it('collapse created and completed deliveries of one re-run to its newest attempt', () => {
    const names = fixtureNames.filter((name) => name.startsWith('check-run-'))
    const samples = names
      .map((name) => checkSampleOfPayload(payloadOf(name)))
      .filter((sample) => sample !== null)
    const rerunHead = 'bf10f09b1c1963762d1a9eadd679e1c9c25f7160'
    const attempts = samples
      .filter((sample) => sample.headSha === rerunHead)
      .map((sample) => checksIdentityOf({ sample }))
    const derived = derivedChecksOf({ attempts, headSha: rerunHead, requiredContexts: [] })
    const latest = latestCheckAttempts({ attempts })

    expect(samples.length).toBe(names.length)
    expect(attempts.length).toBeGreaterThan(1)
    expect(new Set(attempts.map((attempt) => attempt.checkKey)).size).toBe(1)
    expect(latest).toHaveLength(1)
    expect(latest[0]?.outcome).toBe(ECheckOutcome.Failed)
    expect(latest[0]?.sourceCreatedAt).toBe('2026-11-18T21:06:55Z')
    expect(derived).toMatchObject({ failed: 1, running: 0 })
  })

  it('collapse two statuses with one context to the latest id', () => {
    const success = required(checkSampleOfPayload(payloadOf('status-success.json')))
    const pending = required(checkSampleOfPayload(payloadOf('status-pending.json')))
    const attempts = [checksIdentityOf({ sample: success }), checksIdentityOf({ sample: pending })]
    const derived = derivedChecksOf({ attempts, headSha: success.headSha, requiredContexts: [] })

    expect(success.headSha).toBe(pending.headSha)
    expect(attempts.map((attempt) => attempt.checkKey)).toEqual(['status:probe', 'status:probe'])
    expect(latestCheckAttempts({ attempts })).toHaveLength(1)
    expect(derived).toMatchObject({
      running: 0,
      passed: 1,
      failed: 0,
      rollup: EChecksState.Passing,
    })
  })
})
