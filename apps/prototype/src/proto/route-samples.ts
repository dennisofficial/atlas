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

export function patternMatchesPath({
  pattern,
  pathname,
}: {
  pattern: string
  pathname: string
}): boolean {
  const patternSegments = segmentsOf(pattern)
  const pathSegments = segmentsOf(splitFramePath(pathname).pathname)
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every(
    (segment, index) => isDynamicSegment(segment) || segment === pathSegments[index],
  )
}

export function matchRoute({
  path,
  samples,
}: {
  path: string
  samples: Record<string, ProtoSample[]>
}): RouteMatch | null {
  const { pathname } = splitFramePath(path)
  const entry = Object.entries(samples).find(([pattern]) =>
    patternMatchesPath({ pattern, pathname }),
  )
  if (!entry) return null
  const [pattern, routeSamples] = entry
  const current =
    routeSamples.find((sample) => splitFramePath(sample.path).pathname === pathname) ?? null
  return { pattern, samples: routeSamples, current }
}
