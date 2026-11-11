import { describe, expect, it } from 'bun:test'

import {
  artifactBuildSchema,
  artifactGetOutputSchema,
  artifactRouteSchema,
  artifactSummarySchema,
} from '../artifacts'

const ROUTE = {
  artifactId: 'art_1',
  subdomain: 'k7f2m9qxabcd',
  name: 'Dashboard',
  serve: { spa: true, notFound: '404.html' },
}

const SUMMARY = {
  subdomain: 'k7f2m9qxabcd',
  name: 'Dashboard',
  url: 'https://k7f2m9qxabcd.byatlas.site',
  status: 'ready' as const,
  updatedAt: '2026-11-10T09:00:00.000Z',
}

const BUILD = {
  status: 'ready' as const,
  log: 'bun run build\nbuilt in 4.2s',
  failure: null,
  durationMs: 4200,
  updatedAt: '2026-11-10T09:00:00.000Z',
}

describe('artifactRouteSchema', () => {
  it('round-trips the route object the host reads', () => {
    expect(artifactRouteSchema.parse(JSON.parse(JSON.stringify(ROUTE)))).toEqual(ROUTE)
  })

  it('round-trips serve rules that name no custom 404', () => {
    const route = { ...ROUTE, serve: { spa: false } }

    expect(artifactRouteSchema.parse(route)).toEqual(route)
  })

  it('carries no manifest and no version', () => {
    const parsed = artifactRouteSchema.parse(ROUTE) as Record<string, unknown>

    expect(parsed.manifest).toBeUndefined()
    expect(parsed.version).toBeUndefined()
  })

  it('rejects a route without serve rules', () => {
    const { serve: _serve, ...withoutServe } = ROUTE

    expect(artifactRouteSchema.safeParse(withoutServe).success).toBe(false)
  })

  it('rejects serve rules without spa', () => {
    expect(
      artifactRouteSchema.safeParse({ ...ROUTE, serve: { notFound: '404.html' } }).success,
    ).toBe(false)
  })

  it.each(['Upper', '-lead', 'trail-', 'dot.dot', 'a'.repeat(64)])(
    'rejects the subdomain %p',
    (subdomain) => {
      expect(artifactRouteSchema.safeParse({ ...ROUTE, subdomain }).success).toBe(false)
    },
  )
})

describe('artifactSummarySchema', () => {
  it('accepts the fields the artifact list needs', () => {
    expect(artifactSummarySchema.parse(SUMMARY)).toEqual(SUMMARY)
  })

  it('drops version history', () => {
    const parsed = artifactSummarySchema.parse(SUMMARY) as Record<string, unknown>

    expect(parsed.currentVersion).toBeUndefined()
    expect(parsed.sourceHash).toBeUndefined()
  })
})

describe('artifactBuildSchema', () => {
  it('accepts a stored build log and duration', () => {
    expect(artifactBuildSchema.parse(BUILD)).toEqual(BUILD)
  })

  it('accepts a failed build with its reason and no log', () => {
    const failed = {
      status: 'failed' as const,
      log: null,
      failure: 'exit 1',
      durationMs: null,
      updatedAt: '2026-11-10T09:00:00.000Z',
    }

    expect(artifactBuildSchema.parse(failed)).toEqual(failed)
  })
})

describe('artifactGetOutputSchema', () => {
  it('pairs the summary with the build it last ran', () => {
    expect(artifactGetOutputSchema.parse({ artifact: SUMMARY, build: BUILD })).toEqual({
      artifact: SUMMARY,
      build: BUILD,
    })
  })

  it('rejects the old manifest and version list', () => {
    const legacy = { artifact: SUMMARY, versions: [], current: [] }

    expect(artifactGetOutputSchema.safeParse(legacy).success).toBe(false)
  })
})
