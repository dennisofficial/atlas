import { describe, expect, it } from 'bun:test'

import {
  ARTIFACT_BUILD_OUTCOMES,
  artifactBuildSchema,
  artifactBuildOutcomeSchema,
  artifactBuildStatusInputSchema,
  artifactBuildStatusOutputSchema,
  artifactCommitPublishInputSchema,
  artifactGetOutputSchema,
  artifactRouteSchema,
  artifactSummarySchema,
} from '../artifacts'

const ROUTE = {
  artifactId: 'art_1',
  subdomain: 'k7f2m9qxabcd',
  name: 'Dashboard',
  version: 3,
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

  it('carries the live version and no manifest', () => {
    const parsed = artifactRouteSchema.parse(ROUTE) as Record<string, unknown>

    expect(parsed.version).toBe(3)
    expect(parsed.manifest).toBeUndefined()
  })

  it('requires the live version', () => {
    const { version: _version, ...withoutVersion } = ROUTE

    expect(artifactRouteSchema.safeParse(withoutVersion).success).toBe(false)
  })

  it.each([0, -1, 1.5])('rejects the version %p', (version) => {
    expect(artifactRouteSchema.safeParse({ ...ROUTE, version }).success).toBe(false)
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

describe('artifactCommitPublishInputSchema', () => {
  it('accepts a commit without a spec', () => {
    const input = { artifactId: 'art_1', version: 3 }

    expect(artifactCommitPublishInputSchema.parse(input)).toEqual(input)
  })

  it('accepts a commit carrying the spec an older client still sends', () => {
    const input = { artifactId: 'art_1', version: 3, spec: { build: { command: 'bun run build' } } }

    expect(artifactCommitPublishInputSchema.parse(input)).toEqual(input)
  })
})

describe('artifactBuildStatusInputSchema', () => {
  it('names the artifact and the version being built', () => {
    const input = { subdomain: 'k7f2m9qxabcd', version: 3 }

    expect(artifactBuildStatusInputSchema.parse(input)).toEqual(input)
  })

  it.each([0, -1, 1.5])('rejects the version %p', (version) => {
    expect(
      artifactBuildStatusInputSchema.safeParse({ subdomain: 'k7f2m9qxabcd', version }).success,
    ).toBe(false)
  })
})

describe('artifactBuildStatusOutputSchema', () => {
  const STATUS = {
    subdomain: 'k7f2m9qxabcd',
    version: 3,
    url: 'https://k7f2m9qxabcd.byatlas.site',
    outcome: 'ready' as const,
    failure: null,
    log: 'bun run build\nbuilt in 4.2s',
    durationMs: 4200,
    supersededBy: null,
  }

  it('round-trips the outcome of a finished build', () => {
    expect(artifactBuildStatusOutputSchema.parse(STATUS)).toEqual(STATUS)
  })

  it('carries the version that superseded a build', () => {
    const superseded = {
      ...STATUS,
      outcome: 'superseded' as const,
      durationMs: null,
      supersededBy: 4,
    }

    expect(artifactBuildStatusOutputSchema.parse(superseded)).toEqual(superseded)
  })

  it.each(ARTIFACT_BUILD_OUTCOMES)('accepts the outcome %p', (outcome) => {
    expect(artifactBuildOutcomeSchema.parse(outcome)).toBe(outcome)
  })

  it.each(['queued', 'done', 'READY', ''])('rejects the outcome %p', (outcome) => {
    expect(artifactBuildOutcomeSchema.safeParse(outcome).success).toBe(false)
    expect(artifactBuildStatusOutputSchema.safeParse({ ...STATUS, outcome }).success).toBe(false)
  })

  it('rejects a build that is not there at all', () => {
    expect(
      artifactBuildStatusOutputSchema.safeParse({ subdomain: 'k7f2m9qxabcd', version: 3 }).success,
    ).toBe(false)
  })
})
