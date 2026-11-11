import { describe, expect, it } from 'bun:test'

import { routeCandidatesOf, type RouteResolution } from '../resolve'
import type { ArtifactSpec } from '../spec'

const ID = 'k7f2m9qxabcd'

const resolveOf = (args: {
  pathname: string
  serve?: Partial<ArtifactSpec['serve']>
}): RouteResolution | null =>
  routeCandidatesOf({
    id: ID,
    pathname: args.pathname,
    serve: { spa: false, ...args.serve },
  })

const pathsOf = (resolution: RouteResolution | null): string[] =>
  resolution === null ? ['rejected'] : resolution.candidates.map((candidate) => candidate.path)

const notFoundOf = (resolution: RouteResolution | null): string | null =>
  resolution?.notFound?.path ?? null

describe('routeCandidatesOf', () => {
  it('serves the root index first', () => {
    const resolution = resolveOf({ pathname: '/' })

    expect(pathsOf(resolution)).toEqual(['index.html'])
    expect(resolution?.candidates[0]?.key).toBe(`artifacts/${ID}/_route/index.html`)
  })

  it('tries the exact path before its index', () => {
    expect(pathsOf(resolveOf({ pathname: '/assets/app.js' }))).toEqual([
      'assets/app.js',
      'assets/app.js/index.html',
    ])
  })

  it('collapses a trailing slash into the directory index', () => {
    expect(pathsOf(resolveOf({ pathname: '/about/' }))).toEqual(['about', 'about/index.html'])
  })

  it('falls back to the SPA shell for a dotless client route', () => {
    expect(pathsOf(resolveOf({ pathname: '/settings/profile', serve: { spa: true } }))).toEqual([
      'settings/profile',
      'settings/profile/index.html',
      'index.html',
    ])
  })

  it('does not serve the SPA shell for a dotted path', () => {
    expect(pathsOf(resolveOf({ pathname: '/missing.js', serve: { spa: true } }))).toEqual([
      'missing.js',
      'missing.js/index.html',
    ])
  })

  it('names the custom 404 file', () => {
    const resolution = resolveOf({ pathname: '/missing', serve: { notFound: '404.html' } })

    expect(notFoundOf(resolution)).toBe('404.html')
    expect(resolution?.notFound?.key).toBe(`artifacts/${ID}/_route/404.html`)
  })

  it('does not repeat the SPA shell as the custom 404', () => {
    const resolution = resolveOf({
      pathname: '/missing',
      serve: { spa: true, notFound: 'index.html' },
    })

    expect(pathsOf(resolution)).toEqual(['missing', 'missing/index.html', 'index.html'])
    expect(resolution?.notFound?.key).toBe(`artifacts/${ID}/_route/index.html`)
  })

  it('orders every key under the artifact route prefix', () => {
    const resolution = resolveOf({ pathname: '/docs', serve: { spa: true, notFound: '404.html' } })
    const keys = [
      ...(resolution?.candidates.map((candidate) => candidate.key) ?? []),
      resolution?.notFound?.key ?? '',
    ]

    for (const key of keys) expect(key.startsWith(`artifacts/${ID}/_route/`)).toBe(true)
  })

  it.each(['/..', '/%2e%2e/x', '/%2f/..', '/..%2fsecret', '/a\\b', '/index.html%00.js', '/./'])(
    'rejects the traversal path %p',
    (pathname) => {
      expect(resolveOf({ pathname, serve: { spa: true, notFound: '404.html' } })).toBeNull()
    },
  )
})
