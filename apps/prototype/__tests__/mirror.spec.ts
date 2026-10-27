import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { PROTO_SAMPLES } from '../src/proto/samples'

const PROTOTYPE_ROOT = resolve(import.meta.dir, '..')
const WEB_ROOT = resolve(PROTOTYPE_ROOT, '..', 'web')
const WEB_APP = join(WEB_ROOT, 'src', 'app')
const PROTOTYPE_APP = join(PROTOTYPE_ROOT, 'src', 'app')
const WEB_FEATURES = join(WEB_ROOT, 'src', 'features')
const PROTOTYPE_FEATURES = join(PROTOTYPE_ROOT, 'src', 'features')

const ROUTE_FILES = new Set(['page.tsx', 'layout.tsx'])
const WEB_ONLY_SEGMENTS = new Set(['api', 'health'])
const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next'])
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"]+)['"]/g
const FIX = 'add it to apps/prototype — the north star may be ahead of web, never behind'

function walk(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return []
    const full = join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function toSegments(path: string): string[] {
  return path.split(sep).filter(Boolean)
}

function routeFiles({ appRoot, ignored }: { appRoot: string; ignored: Set<string> }): string[] {
  return walk(appRoot)
    .map((file) => relative(appRoot, file))
    .filter((file) => ROUTE_FILES.has(file.split(sep).at(-1) ?? ''))
    .filter((file) => !ignored.has(toSegments(file)[0] ?? ''))
    .sort()
}

function stripGroups(segments: string[]): string[] {
  return segments.filter((segment) => !/^\(.+\)$/.test(segment))
}

function routePattern(file: string): string {
  const segments = stripGroups(toSegments(file).slice(0, -1))
  return `/${segments.join('/')}`
}

function isRedirectOnly(file: string): boolean {
  return /\bredirect\(/.test(readFileSync(join(PROTOTYPE_APP, file), 'utf8'))
}

function isDynamic(pattern: string): boolean {
  return /\[.+\]/.test(pattern)
}

function patternMatches({ pattern, path }: { pattern: string; path: string }): boolean {
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = (path.split(/[?#]/)[0] ?? '').split('/').filter(Boolean)
  for (const [index, segment] of patternSegments.entries()) {
    const catchAll = /^\[\[?\.\.\./.test(segment)
    if (catchAll) {
      const optional = segment.startsWith('[[')
      return index === patternSegments.length - 1 && (optional || pathSegments.length > index)
    }
    const actual = pathSegments[index]
    if (actual === undefined) return false
    if (/^\[.+\]$/.test(segment)) continue
    if (segment !== actual) return false
  }
  return pathSegments.length === patternSegments.length
}

function failWith({ headline, items }: { headline: string; items: string[] }): void {
  if (items.length === 0) return
  const lines = items.map((item) => `  - ${item}`).join('\n')
  throw new Error(`${headline}\n${lines}\n${FIX}`)
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? '')
}

function sourceFiles(directory: string): string[] {
  return walk(directory).filter((file) => SOURCE_FILE.test(file))
}

function isInside({ parent, child }: { parent: string; child: string }): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.startsWith(sep))
}

describe('prototype mirrors apps/web', () => {
  test('every web page.tsx and layout.tsx exists at the same path under apps/prototype/src/app', () => {
    const webRoutes = routeFiles({ appRoot: WEB_APP, ignored: WEB_ONLY_SEGMENTS })
    expect(webRoutes.length).toBeGreaterThan(0)
    const missing = webRoutes
      .filter((file) => !existsSync(join(PROTOTYPE_APP, file)))
      .map((file) => `apps/prototype/src/app/${file.split(sep).join('/')}`)
    failWith({
      headline: `apps/web has routes the prototype is missing (${missing.length}):`,
      items: missing,
    })
  })

  test('every directory under apps/web/src/features exists under apps/prototype/src/features', () => {
    const webFeatures = readdirSync(WEB_FEATURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(webFeatures.length).toBeGreaterThan(0)
    const missing = webFeatures
      .filter((name) => !existsSync(join(PROTOTYPE_FEATURES, name)))
      .map((name) => `apps/prototype/src/features/${name}/`)
    failWith({
      headline: `apps/web has feature folders the prototype is missing (${missing.length}):`,
      items: missing,
    })
  })

  test('every dynamic prototype route has a sample, and every sample path matches its pattern', () => {
    const prototypeRoutes = routeFiles({ appRoot: PROTOTYPE_APP, ignored: new Set(['proto']) })
    const dynamicPatterns = [
      ...new Set(
        prototypeRoutes
          .filter((file) => file.endsWith(`${sep}page.tsx`) || file === 'page.tsx')
          .filter((file) => !isRedirectOnly(file))
          .map(routePattern)
          .filter(isDynamic),
      ),
    ].sort()

    const unsampled = dynamicPatterns
      .filter((pattern) => (PROTO_SAMPLES[pattern] ?? []).length === 0)
      .map(
        (pattern) =>
          `PROTO_SAMPLES['${pattern}'] has no entry in apps/prototype/src/proto/samples.ts`,
      )
    failWith({
      headline: `dynamic prototype routes without a sample (${unsampled.length}):`,
      items: unsampled,
    })

    const mismatched = Object.entries(PROTO_SAMPLES).flatMap(([pattern, samples]) =>
      samples
        .filter((sample) => !patternMatches({ pattern, path: sample.path }))
        .map((sample) => `'${sample.path}' (${sample.label}) does not match '${pattern}'`),
    )
    failWith({
      headline: `sample paths that do not match their route (${mismatched.length}):`,
      items: mismatched,
    })
  })

  test('web never imports the prototype and the prototype never imports web', () => {
    const webSource = join(WEB_ROOT, 'src')
    const prototypeSource = join(PROTOTYPE_ROOT, 'src')

    const webOffenders = sourceFiles(webSource).flatMap((file) =>
      importSpecifiers(file)
        .filter((specifier) => {
          if (specifier.includes('apps/prototype') || specifier.includes('atlas-prototype'))
            return true
          if (!specifier.startsWith('.')) return false
          return isInside({ parent: PROTOTYPE_ROOT, child: resolve(dirname(file), specifier) })
        })
        .map((specifier) => `${relative(WEB_ROOT, file)} imports '${specifier}'`),
    )
    failWith({
      headline: `apps/web must not import apps/prototype (${webOffenders.length}):`,
      items: webOffenders,
    })

    const prototypeOffenders = sourceFiles(prototypeSource).flatMap((file) =>
      importSpecifiers(file)
        .filter((specifier) => {
          if (specifier.includes('apps/web')) return true
          if (!specifier.startsWith('.')) return false
          return isInside({ parent: WEB_ROOT, child: resolve(dirname(file), specifier) })
        })
        .map((specifier) => `${relative(PROTOTYPE_ROOT, file)} imports '${specifier}'`),
    )
    failWith({
      headline: `apps/prototype must not import apps/web (${prototypeOffenders.length}):`,
      items: prototypeOffenders,
    })
  })
})

describe('patternMatches', () => {
  test('matches dynamic segments, rejects wrong shapes', () => {
    expect(patternMatches({ pattern: '/threads/[threadId]', path: '/threads/abc' })).toBe(true)
    expect(
      patternMatches({ pattern: '/threads/[threadId]', path: '/threads/abc?state=busy' }),
    ).toBe(true)
    expect(patternMatches({ pattern: '/threads/[threadId]', path: '/threads' })).toBe(false)
    expect(patternMatches({ pattern: '/threads/[threadId]', path: '/threads/a/b' })).toBe(false)
    expect(patternMatches({ pattern: '/threads/[threadId]', path: '/settings/abc' })).toBe(false)
    expect(
      patternMatches({
        pattern: '/projects/[projectId]/settings/[section]',
        path: '/projects/rs-crm/settings/mcp',
      }),
    ).toBe(true)
  })
})
