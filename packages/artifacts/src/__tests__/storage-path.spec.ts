import { describe, expect, it } from 'bun:test'

import {
  ARTIFACTS_PREFIX,
  ArtifactPathError,
  ROUTES_PREFIX,
  ROUTE_TREE,
  routeFilePathOf,
  routePathOf,
  routePrefixOf,
  SOURCE_TREE,
  sourcePathOf,
  sourcePrefixOf,
} from '../storage-path'

const ID = 'k7f2m9qxabcd'

describe('routePathOf', () => {
  it('addresses the route object by artifact id', () => {
    expect(routePathOf({ id: ID })).toBe(`routes/${ID}.json`)
    expect(ROUTES_PREFIX).toBe('routes/')
  })
})

describe('routeFilePathOf', () => {
  it('addresses a published file under artifacts/<id>/_route/', () => {
    expect(routeFilePathOf({ id: ID, path: 'assets/app.js' })).toBe(
      `artifacts/${ID}/_route/assets/app.js`,
    )
    expect(ROUTE_TREE).toBe('_route')
    expect(ARTIFACTS_PREFIX).toBe('artifacts/')
  })

  it('refuses a key that would escape the route tree', () => {
    expect(() => routeFilePathOf({ id: ID, path: '../../other/_route/index.html' })).toThrow(
      ArtifactPathError,
    )
  })
})

describe('sourcePathOf', () => {
  it('addresses an uploaded file under artifacts/<id>/_source/', () => {
    expect(sourcePathOf({ id: ID, path: 'src/index.ts' })).toBe(
      `artifacts/${ID}/_source/src/index.ts`,
    )
    expect(SOURCE_TREE).toBe('_source')
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

  it('joins every file key under its prefix', () => {
    expect(
      routeFilePathOf({ id: ID, path: 'a/b.html' }).startsWith(routePrefixOf({ id: ID })),
    ).toBe(true)
    expect(sourcePathOf({ id: ID, path: 'a/b.html' }).startsWith(sourcePrefixOf({ id: ID }))).toBe(
      true,
    )
  })
})
