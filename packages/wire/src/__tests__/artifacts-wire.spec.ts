import { describe, expect, it } from 'bun:test'

import {
  artifactRouteSchema,
  artifactSummarySchema,
  artifactVersionSummarySchema,
} from '../artifacts'

const ENTRY = {
  path: 'index.html',
  tree: 'dist' as const,
  sha256: 'a'.repeat(64),
  size: 12,
  type: 'text/html; charset=utf-8',
}

const ROUTE = {
  artifactId: 'art_1',
  slug: 'dashboard',
  name: 'Dashboard',
  version: 3,
  manifest: [ENTRY],
}

const SUMMARY = {
  slug: 'dashboard',
  name: 'Dashboard',
  url: 'https://k7f2m9qx-dashboard.byatlas.site',
  currentVersion: 3,
  status: 'ready' as const,
  bytes: 12,
  fileCount: 1,
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-10T09:00:00.000Z',
  sourceHash: 'b'.repeat(64),
  specHash: 'c'.repeat(64),
}

const VERSION = {
  version: 3,
  status: 'ready' as const,
  createdAt: '2026-11-10T09:00:00.000Z',
  bytes: 12,
  fileCount: 1,
  failure: null,
  durationMs: 4200,
  log: 'bun run build\nbuilt in 4.2s',
}

describe('artifactRouteSchema', () => {
  it('round-trips a route object that carries serve rules', () => {
    const route = {
      ...ROUTE,
      serve: { spa: true, notFound: 'index.html' },
    }

    expect(artifactRouteSchema.parse(JSON.parse(JSON.stringify(route)))).toEqual(route)
  })

  it('round-trips a route object whose serve rules name no custom 404', () => {
    const route = { ...ROUTE, serve: { spa: true } }

    expect(artifactRouteSchema.parse(JSON.parse(JSON.stringify(route)))).toEqual(route)
  })

  it('still accepts a routing object written before serve existed', () => {
    expect(artifactRouteSchema.parse(ROUTE)).toEqual(ROUTE)
  })

  it('rejects serve rules without spa', () => {
    expect(
      artifactRouteSchema.safeParse({ ...ROUTE, serve: { notFound: '404.html' } }).success,
    ).toBe(false)
  })
})

describe('artifactSummarySchema', () => {
  it('accepts the hashes and the creation time of a published artifact', () => {
    expect(artifactSummarySchema.parse(SUMMARY)).toEqual(SUMMARY)
  })

  it('accepts an artifact with no version to hash yet', () => {
    const unbuilt = { ...SUMMARY, currentVersion: 0, sourceHash: null, specHash: null }

    expect(artifactSummarySchema.parse(unbuilt)).toEqual(unbuilt)
  })
})

describe('artifactVersionSummarySchema', () => {
  it('accepts a stored build log and duration', () => {
    expect(artifactVersionSummarySchema.parse(VERSION)).toEqual(VERSION)
  })

  it('accepts a version that captured neither', () => {
    const bare = { ...VERSION, status: 'building' as const, durationMs: null, log: null }

    expect(artifactVersionSummarySchema.parse(bare)).toEqual(bare)
  })
})
