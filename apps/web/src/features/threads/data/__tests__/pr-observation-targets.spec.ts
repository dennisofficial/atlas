import { describe, expect, it } from 'bun:test'

import { githubPrStatesInputSchema } from '@dltech/atlas-wire/web'

import {
  EPrObservationPriority,
  prObservationInputOf,
  prObservationKeyOf,
  prObservationTargetsOf,
} from '../pr-observation-targets'

describe('PR observation transport input', () => {
  it('preserves undefined input for legacy and empty cached-only consumers', () => {
    expect(prObservationInputOf()).toBeUndefined()
    expect(prObservationInputOf([])).toBeUndefined()
  })

  it('uses normalized repo+number identity, filters malformed targets, and sends the additive wire contract', () => {
    const input = prObservationInputOf([
      { repo: 'https://github.com/Owner/Repo.git', number: 2 },
      { repo: 'git@github.com:owner/repo.git', number: 2 },
      { repo: 'github.com/OWNER/REPO', number: 1 },
      { repo: 'other/repo', number: 1 },
      { repo: 'https://attacker.test/owner/repo', number: 3 },
      { repo: 'bad path', number: 3 },
      { repo: 'owner/repo', number: 0 },
      { repo: 'owner/repo', number: 1.5 },
      { repo: 'owner/repo', number: Number.POSITIVE_INFINITY },
    ])
    expect(input).toEqual({
      observe: [
        { repo: 'other/repo', number: 1 },
        { repo: 'owner/repo', number: 1 },
        { repo: 'owner/repo', number: 2 },
      ],
    })
    expect(githubPrStatesInputSchema.safeParse(input).success).toBe(true)
  })

  it('strips registration priority and reserves inline slots before deterministic bulk overflow', () => {
    const bulk = Array.from({ length: 140 }, (_, index) => ({
      repo: 'owner/repo',
      number: index + 1,
    }))
    const input = prObservationInputOf([
      ...bulk,
      { repo: 'github.com/OWNER/REPO', number: 140, priority: EPrObservationPriority.Inline },
    ])
    expect(input?.observe).toHaveLength(128)
    expect(input?.observe).toContainEqual({ repo: 'owner/repo', number: 140 })
    expect(input?.observe).toContainEqual({ repo: 'owner/repo', number: 127 })
    expect(input?.observe).not.toContainEqual({ repo: 'owner/repo', number: 128 })
    expect(
      input?.observe?.every((entry) => Object.keys(entry).sort().join(',') === 'number,repo'),
    ).toBe(true)
    expect(githubPrStatesInputSchema.safeParse(input).success).toBe(true)
  })

  it('caps the transport defensively and makes identity order independent', () => {
    const targets = Array.from({ length: 140 }, (_, index) => ({
      repo: 'owner/repo',
      number: 140 - index,
    }))
    expect(prObservationInputOf(targets)?.observe).toHaveLength(128)
    expect(prObservationKeyOf(targets)).toBe(prObservationKeyOf([...targets].reverse()))
    expect(
      prObservationTargetsOf([{ repo: 'owner/repo', number: Number.MAX_SAFE_INTEGER + 1 }]),
    ).toEqual([])
  })
})
