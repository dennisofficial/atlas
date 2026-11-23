import { describe, expect, it } from 'bun:test'

import { planPrune } from '../prune-vcr-images'
import type { PruneImage, SandboxRef } from '../prune-vcr-images'

const image = (args: { id: string; tags: string[]; digest?: string }): PruneImage => ({
  id: args.id,
  tags: args.tags,
  createdAt: Date.parse('2026-10-08T12:00:00Z'),
  manifestDigest: args.digest ?? `sha256:${args.id}`,
})

describe('planPrune', () => {
  it('keeps the latest-tagged image', () => {
    const plan = planPrune({ images: [image({ id: 'a', tags: ['latest'] })], sandboxes: [] })
    expect(plan.delete).toEqual([])
    expect(plan.keep.map((i) => i.id)).toEqual(['a'])
  })

  it('deletes release, sha and untagged images nothing boots from', () => {
    const plan = planPrune({
      images: [
        image({ id: 'release', tags: ['1.81.3'] }),
        image({ id: 'sha', tags: ['sha-d045b61'] }),
        image({ id: 'none', tags: [] }),
      ],
      sandboxes: [],
    })
    expect(plan.delete.map((i) => i.id)).toEqual(['release', 'sha', 'none'])
  })

  it('keeps any image whose digest a sandbox booted from, running or stopped', () => {
    const stale = image({ id: 'stale', tags: [], digest: 'sha256:inuse' })
    const sandbox: SandboxRef = { image: 'comp-ai/atlas-web/atlas-sandbox@sha256:inuse' }
    const plan = planPrune({ images: [stale], sandboxes: [sandbox] })
    expect(plan.delete).toEqual([])
    expect(plan.keep.map((i) => i.id)).toEqual(['stale'])
  })

  it('matches sandbox references by digest across registry-host forms', () => {
    const img = image({ id: 'x', tags: [], digest: 'sha256:abc123' })
    const byDigest: SandboxRef = {
      image: 'vcr.vercel.com/comp-ai/atlas-web/atlas-sandbox@sha256:abc123',
    }
    const other: SandboxRef = { image: 'comp-ai/atlas-web/atlas-sandbox@sha256:different' }
    expect(planPrune({ images: [img], sandboxes: [byDigest] }).delete).toEqual([])
    expect(planPrune({ images: [img], sandboxes: [other] }).delete.map((i) => i.id)).toEqual(['x'])
  })

  it('ignores sandboxes that report no image', () => {
    const plan = planPrune({ images: [image({ id: 'a', tags: [] })], sandboxes: [{}] })
    expect(plan.delete.map((i) => i.id)).toEqual(['a'])
  })
})
