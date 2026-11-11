import { describe, expect, it } from 'bun:test'

import type { ManifestEntry } from '../manifest'
import { resolveRequest, type Resolution } from '../resolve'
import type { ArtifactSpec } from '../spec'

const entryOf = (path: string): ManifestEntry => ({
  path,
  tree: 'dist',
  sha256: 'a'.repeat(64),
  size: 1,
  type: 'text/plain; charset=utf-8',
})

const filesOf = (paths: readonly string[]): Map<string, ManifestEntry> =>
  new Map(paths.map((path) => [path, entryOf(path)]))

const describeResolution = (resolution: Resolution): string =>
  resolution.kind === 'file' ? resolution.entry.path : `404:${resolution.entry?.path ?? ''}`

const resolveOf = (args: {
  pathname: string
  paths: readonly string[]
  serve?: Partial<ArtifactSpec['serve']>
}): string =>
  describeResolution(
    resolveRequest({
      pathname: args.pathname,
      files: filesOf(args.paths),
      serve: { spa: false, ...args.serve },
    }),
  )

const site = ['index.html', 'about/index.html', 'assets/app.js', '404.html', 'docs/guide.html']

const cases: readonly {
  name: string
  pathname: string
  paths: readonly string[]
  serve?: Partial<ArtifactSpec['serve']>
  expected: string
}[] = [
  { name: 'root index', pathname: '/', paths: site, expected: 'index.html' },
  { name: 'exact file', pathname: '/assets/app.js', paths: site, expected: 'assets/app.js' },
  {
    name: 'directory index via trailing slash',
    pathname: '/about/',
    paths: site,
    expected: 'about/index.html',
  },
  {
    name: 'directory index without slash',
    pathname: '/about',
    paths: site,
    expected: 'about/index.html',
  },
  {
    name: 'pathname without a leading slash',
    pathname: 'assets/app.js',
    paths: site,
    expected: 'assets/app.js',
  },
  {
    name: 'collapsed duplicate slashes',
    pathname: '//assets///app.js',
    paths: site,
    expected: 'assets/app.js',
  },
  {
    name: 'percent-encoded space',
    pathname: '/my%20page.html',
    paths: ['my page.html'],
    expected: 'my page.html',
  },
  { name: 'missing file', pathname: '/missing.html', paths: site, expected: '404:' },
  { name: 'case-sensitive lookup', pathname: '/ASSETS/app.js', paths: site, expected: '404:' },
  {
    name: 'case-sensitive spa guard',
    pathname: '/INDEX.HTML',
    paths: site,
    serve: { spa: true },
    expected: '404:',
  },
  {
    name: 'spa falls back for a dotless last segment',
    pathname: '/about-us',
    paths: site,
    serve: { spa: true },
    expected: 'index.html',
  },
  {
    name: 'spa does not catch a dotted last segment',
    pathname: '/missing.html',
    paths: site,
    serve: { spa: true },
    expected: '404:',
  },
  {
    name: 'spa still serves a real asset',
    pathname: '/assets/app.js',
    paths: site,
    serve: { spa: true },
    expected: 'assets/app.js',
  },
  {
    name: 'custom notFound page',
    pathname: '/missing',
    paths: site,
    serve: { notFound: '404.html' },
    expected: '404:404.html',
  },
  {
    name: 'missing custom notFound page',
    pathname: '/missing',
    paths: site,
    serve: { notFound: 'gone.html' },
    expected: '404:',
  },
  {
    name: 'spa wins over notFound',
    pathname: '/missing',
    paths: site,
    serve: { spa: true, notFound: '404.html' },
    expected: 'index.html',
  },
  { name: 'traversal segment is rejected', pathname: '/../secret', paths: site, expected: '404:' },
  {
    name: 'encoded traversal is rejected',
    pathname: '/%2e%2e/secret',
    paths: site,
    expected: '404:',
  },
  {
    name: 'encoded slash traversal is rejected',
    pathname: '/assets%2f..%2f..%2fsecret',
    paths: site,
    expected: '404:',
  },
  { name: 'NUL byte is rejected', pathname: '/index.html%00.js', paths: site, expected: '404:' },
  {
    name: 'malformed percent escape is rejected',
    pathname: '/%zz',
    paths: ['%zz'],
    expected: '404:',
  },
  {
    name: 'dot segments are dropped',
    pathname: '/./assets/./app.js',
    paths: site,
    expected: 'assets/app.js',
  },
]

describe('resolveRequest', () => {
  it.each(cases)('$name', ({ pathname, paths, serve, expected }) => {
    expect(resolveOf({ pathname, paths, ...(serve === undefined ? {} : { serve }) })).toBe(expected)
  })

  it('returns the file entry itself', () => {
    const resolution = resolveRequest({
      pathname: '/assets/app.js',
      files: filesOf(site),
      serve: { spa: false },
    })
    expect(resolution.kind).toBe('file')
    expect(resolution.kind === 'file' ? resolution.entry.size : 0).toBe(1)
  })

  it('always reports status 404 for misses', () => {
    expect(
      resolveRequest({ pathname: '/missing', files: filesOf(site), serve: { spa: false } }),
    ).toEqual({ kind: 'notFound', status: 404 })
  })
})
