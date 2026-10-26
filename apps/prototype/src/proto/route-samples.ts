import { splitFramePath } from './frame-path'
import type { ProtoSample } from './samples'

export interface RouteMatch {
  pattern: string
  samples: ProtoSample[]
  current: ProtoSample | null
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '')
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']')
}

const NO_STATIC_PATHS: ReadonlySet<string> = new Set()

export function patternMatchesPath({
  pattern,
  pathname,
  staticPaths = NO_STATIC_PATHS,
}: {
  pattern: string
  pathname: string
  staticPaths?: ReadonlySet<string>
}): boolean {
  const bare = splitFramePath(pathname).pathname
  if (pattern !== bare && staticPaths.has(bare)) return false
  const patternSegments = segmentsOf(pattern)
  const pathSegments = segmentsOf(bare)
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every(
    (segment, index) => isDynamicSegment(segment) || segment === pathSegments[index],
  )
}

export function matchRoute({
  path,
  samples,
  staticPaths = NO_STATIC_PATHS,
}: {
  path: string
  samples: Record<string, ProtoSample[]>
  staticPaths?: ReadonlySet<string>
}): RouteMatch | null {
  const { pathname } = splitFramePath(path)
  const entry = Object.entries(samples).find(([pattern]) =>
    patternMatchesPath({ pattern, pathname, staticPaths }),
  )
  if (!entry) return null
  const [pattern, routeSamples] = entry
  const current =
    routeSamples.find((sample) => splitFramePath(sample.path).pathname === pathname) ?? null
  return { pattern, samples: routeSamples, current }
}
