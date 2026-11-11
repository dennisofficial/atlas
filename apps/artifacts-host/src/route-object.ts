import {
  blobPathOf,
  parseSpec,
  routePathOf,
  safeParseManifest,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'

import type { HostLabel } from './host-label'

export type RouteObject = {
  artifactId: string
  slug: string
  name: string
  version: number
  manifest: ManifestEntry[]
  serve: ArtifactSpec['serve']
}

export type RouteObjectFetcher = (label: HostLabel) => Promise<RouteObject | null>
export type BlobFetcher = (sha256: string) => Promise<Response | null>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const parseServe = (raw: unknown): ArtifactSpec['serve'] | null => {
  if (raw === undefined) return { spa: false }
  try {
    return parseSpec({ serve: raw }).serve
  } catch {
    return null
  }
}

export function parseRouteObject(raw: unknown): RouteObject | null {
  if (!isRecord(raw)) return null
  const { artifactId, slug, name, version, manifest, serve } = raw
  if (!isFilled(artifactId) || !isFilled(slug) || !isFilled(name)) return null
  if (!isVersion(version)) return null
  const parsed = safeParseManifest(manifest)
  const parsedServe = parseServe(serve)
  if (!parsed.ok || parsedServe === null) return null
  return { artifactId, slug, name, version, manifest: parsed.entries, serve: parsedServe }
}

const objectUrlOf = ({ baseUrl, path }: { baseUrl: string; path: string }): string =>
  `${baseUrl.replace(/\/+$/, '')}/${path}`

export const createRouteFetcher =
  (baseUrl: string): RouteObjectFetcher =>
  async (label) => {
    try {
      const response = await fetch(objectUrlOf({ baseUrl, path: routePathOf(label) }), {
        cache: 'no-store',
      })
      if (!response.ok) return null
      return parseRouteObject(await response.json())
    } catch {
      return null
    }
  }

export const createBlobFetcher =
  (baseUrl: string): BlobFetcher =>
  async (sha256) => {
    try {
      const response = await fetch(objectUrlOf({ baseUrl, path: blobPathOf(sha256) }))
      return response.ok ? response : null
    } catch {
      return null
    }
  }
