import { describe, expect, it } from 'bun:test'

import { planPrune, SEMVER_TAG } from '../prune-vcr-images'
import type { PruneImage, SandboxRef } from '../prune-vcr-images'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-08T12:00:00Z')

const image = (args: { id: string; tags: string[]; createdAt: string; digest?: string }): PruneImage => ({
  id: args.id,
  tags: args.tags,
  createdAt: Date.parse(args.createdAt),
  manifestDigest: args.digest ?? `sha256:${args.id}`,
})

describe('SEMVER_TAG', () => {
  it('matches release tags and nothing else', () => {
    expect(SEMVER_TAG.test('1.81.3')).toBe(true)
    expect(SEMVER_TAG.test('0.19.0')).toBe(true)
    expect(SEMVER_TAG.test('latest')).toBe(false)
    expect(SEMVER_TAG.test('sha-d045b61')).toBe(false)
    expect(SEMVER_TAG.test('1.81')).toBe(false)
    expect(SEMVER_TAG.test('1.81.3-rc')).toBe(false)
  })
})

describe('planPrune', () => {
  it('keeps semver tags younger than the window', () => {
    const plan = planPrune({
      images: [image({ id: 'a', tags: ['1.81.3'], createdAt: '2026-10-07T12:00:00Z' })],
      sandboxes: [],
      now: NOW,
      windowMs: 7 * DAY_MS,
    })
    expect(plan.delete).toEqual([])
    expect(plan.keep.map((i) => i.id)).toEqual(['a'])
  })

  it('deletes semver tags older than the window', () => {
    const plan = planPrune({
      images: [image({ id: 'a', tags: ['1.70.0'], createdAt: '2026-09-20T12:00:00Z' })],
      sandboxes: [],
      now: NOW,
      windowMs: 7 * DAY_MS,
    })
    expect(plan.delete.map((i) => i.id)).toEqual(['a'])
  })

  it('deletes non-semver tags regardless of age', () => {
    const plan = planPrune({
      images: [
        image({ id: 'sha', tags: ['sha-d045b61'], createdAt: '2026-10-08T11:00:00Z' }),
        image({ id: 'latest', tags: ['latest'], createdAt: '2026-10-08T11:30:00Z' }),
        image({ id: 'none', tags: [], createdAt: '2026-10-08T11:45:00Z' }),
      ],
      sandboxes: [],
      now: NOW,
      windowMs: 7 * DAY_MS,
    })
    expect(plan.delete.map((i) => i.id)).toEqual(['sha', 'latest', 'none'])
  })

  it('keeps any image whose digest a live sandbox booted from, even past the window', () => {
    const stale = image({
      id: 'stale',
      tags: ['1.70.0'],
      createdAt: '2026-09-20T12:00:00Z',
      digest: 'sha256:inuse',
    })
    const sandbox: SandboxRef = { image: 'comp-ai/atlas/atlas-sandbox@sha256:inuse' }
    const plan = planPrune({ images: [stale], sandboxes: [sandbox], now: NOW, windowMs: 7 * DAY_MS })
    expect(plan.delete).toEqual([])
    expect(plan.keep.map((i) => i.id)).toEqual(['stale'])
  })

  it('matches sandbox references by digest across tag and digest forms', () => {
    const img = image({
      id: 'x',
      tags: ['1.70.0'],
      createdAt: '2026-09-20T12:00:00Z',
      digest: 'sha256:abc123',
    })
    const byDigest: SandboxRef = { image: 'vcr.vercel.com/comp-ai/atlas/atlas-sandbox@sha256:abc123' }
    const other: SandboxRef = { image: 'comp-ai/atlas/atlas-sandbox@sha256:different' }
    expect(planPrune({ images: [img], sandboxes: [byDigest], now: NOW, windowMs: 7 * DAY_MS }).delete).toEqual([])
    expect(planPrune({ images: [img], sandboxes: [other], now: NOW, windowMs: 7 * DAY_MS }).delete.map((i) => i.id)).toEqual(['x'])
  })

  it('an image with several tags is kept when any of them is in-window', () => {
    const plan = planPrune({
      images: [image({ id: 'multi', tags: ['sha-abc1234', '1.81.3'], createdAt: '2026-10-07T12:00:00Z' })],
      sandboxes: [],
      now: NOW,
      windowMs: 7 * DAY_MS,
    })
    expect(plan.keep.map((i) => i.id)).toEqual(['multi'])
  })
})
