import { describe, expect, it } from 'bun:test'

import {
  ARTIFACTS_PREFIX,
  ArtifactPathError,
  ROUTES_PREFIX,
  ROUTE_TREE,
  ROUTE_VERSION_PREFIX,
  routeFilePathOf,
  routePathOf,
  routePrefixOf,
  routeVersionOfKey,
  routeVersionPrefixOf,
  SOURCE_TREE,
  sourceFilePathOf,
  sourcePrefixOf,
  sourceVersionOfKey,
  sourceVersionPrefixOf,
} from '../storage-path'

const ID = 'k7f2m9qxabcd'

describe('routePathOf', () => {
  it('addresses the route object by artifact id', () => {
    expect(routePathOf({ id: ID })).toBe(`routes/${ID}.json`)
    expect(ROUTES_PREFIX).toBe('routes/')
  })
})

describe('routeVersionPrefixOf', () => {
  it('names the folder of one version of the route tree', () => {
    expect(routeVersionPrefixOf({ id: ID, version: 12 })).toBe(`artifacts/${ID}/_route/v12/`)
    expect(ROUTE_VERSION_PREFIX).toBe('v')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses the route version %p',
    (version) => {
      expect(() => routeVersionPrefixOf({ id: ID, version })).toThrow(ArtifactPathError)
    },
  )
})

describe('routeFilePathOf', () => {
  it('addresses a published file under artifacts/<id>/_route/v<version>/', () => {
    expect(routeFilePathOf({ id: ID, version: 3, path: 'assets/app.js' })).toBe(
      `artifacts/${ID}/_route/v3/assets/app.js`,
    )
    expect(ROUTE_TREE).toBe('_route')
    expect(ARTIFACTS_PREFIX).toBe('artifacts/')
  })

  it('refuses a key that would escape the route tree', () => {
    expect(() =>
      routeFilePathOf({ id: ID, version: 3, path: '../../other/_route/index.html' }),
    ).toThrow(ArtifactPathError)
  })
})

describe('routeVersionOfKey', () => {
  it('parses the version folder of a stored key', () => {
    expect(routeVersionOfKey({ id: ID, key: `artifacts/${ID}/_route/v12/index.html` })).toBe(12)
    expect(routeVersionOfKey({ id: ID, key: `artifacts/${ID}/_route/v1/` })).toBe(1)
  })

  it.each([
    `artifacts/${ID}/_route/v0/index.html`,
    `artifacts/${ID}/_route/v01/index.html`,
    `artifacts/${ID}/_route/vx/index.html`,
    `artifacts/${ID}/_route/index.html`,
    `artifacts/${ID}/_route/`,
    `artifacts/${ID}/_source/v3/index.html`,
    `artifacts/otherid/_route/v3/index.html`,
  ])('reads no version from the key %p', (key) => {
    expect(routeVersionOfKey({ id: ID, key })).toBeNull()
  })

  it('reads no version from a legacy unversioned file', () => {
    expect(routeVersionOfKey({ id: ID, key: `artifacts/${ID}/_route/index.html` })).toBeNull()
  })
})

describe('sourceVersionPrefixOf', () => {
  it('names the folder of one version of the source tree', () => {
    expect(sourceVersionPrefixOf({ id: ID, version: 4 })).toBe(`artifacts/${ID}/_source/v4/`)
    expect(SOURCE_TREE).toBe('_source')
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses the source version %p', (version) => {
    expect(() => sourceVersionPrefixOf({ id: ID, version })).toThrow(ArtifactPathError)
  })
})

describe('sourceFilePathOf', () => {
  it('addresses an uploaded file under artifacts/<id>/_source/v<version>/', () => {
    expect(sourceFilePathOf({ id: ID, version: 3, path: 'src/index.ts' })).toBe(
      `artifacts/${ID}/_source/v3/src/index.ts`,
    )
  })

  it('refuses a key that would escape the source tree', () => {
    expect(() =>
      sourceFilePathOf({ id: ID, version: 3, path: '../other/_source/index.html' }),
    ).toThrow(ArtifactPathError)
  })

  it.each(['', '/absolute.html', 'a\\b.html', 'a/../b.html', 'a//b.html', 'a/./b.html'])(
    'refuses the path %p',
    (path) => {
      expect(() => sourceFilePathOf({ id: ID, version: 3, path })).toThrow(ArtifactPathError)
    },
  )
})

describe('sourceVersionOfKey', () => {
  it('parses the version folder of a stored key', () => {
    expect(sourceVersionOfKey({ id: ID, key: `artifacts/${ID}/_source/v7/index.html` })).toBe(7)
  })

  it.each([
    `artifacts/${ID}/_source/index.html`,
    `artifacts/${ID}/_source/v0/index.html`,
    `artifacts/${ID}/_source/v01/index.html`,
    `artifacts/${ID}/_route/v3/index.html`,
  ])('reads no version from the key %p', (key) => {
    expect(sourceVersionOfKey({ id: ID, key })).toBeNull()
  })
})

describe('prefixes', () => {
  it('names the route prefix for list and delete', () => {
    expect(routePrefixOf({ id: ID })).toBe(`artifacts/${ID}/_route/`)
  })

  it('names the source prefix for list and delete', () => {
    expect(sourcePrefixOf({ id: ID })).toBe(`artifacts/${ID}/_source/`)
  })

  it('keeps two artifacts on disjoint prefixes', () => {
    const first = routePrefixOf({ id: 'aaaaaaaaaaaa' })
    const second = routePrefixOf({ id: 'aaaaaaaaaaaab' })

    expect(first.startsWith(second)).toBe(false)
    expect(second.startsWith(first)).toBe(false)
  })

  it('joins every file key under its version prefix', () => {
    expect(
      routeFilePathOf({ id: ID, version: 3, path: 'a/b.html' }).startsWith(
        routeVersionPrefixOf({ id: ID, version: 3 }),
      ),
    ).toBe(true)
    expect(
      sourceFilePathOf({ id: ID, version: 3, path: 'a/b.html' }).startsWith(
        sourceVersionPrefixOf({ id: ID, version: 3 }),
      ),
    ).toBe(true)
  })
})
