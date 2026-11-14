import {
  parseSpec,
  routePathOf,
  subdomainOfLabel,
  type ArtifactSpec,
} from '@dltech/atlas-artifacts'

import type { HostSubdomain } from './host-label'

export type RouteObject = {
  artifactId: string
  subdomain: HostSubdomain
  name: string
  serve: ArtifactSpec['serve']
}

export type RouteObjectFetcher = (subdomain: HostSubdomain) => Promise<RouteObject | null>

export type StoredObject = { body: ReadableStream<Uint8Array>; etag: string }

export type BucketObject = {
  body: ReadableStream<Uint8Array>
  httpEtag: string
  text(): Promise<string>
}

export type ArtifactBucket = { get(key: string): Promise<BucketObject | null> }

export type ObjectFetcher = (key: string) => Promise<StoredObject | null>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const parseServe = (raw: unknown): ArtifactSpec['serve'] | null => {
  try {
    return parseSpec({ serve: raw }).serve
  } catch {
    return null
  }
}

export function parseRouteObject(raw: unknown): RouteObject | null {
  if (!isRecord(raw)) return null
  const { artifactId, subdomain, name, serve } = raw
  if (!isFilled(artifactId) || !isFilled(name)) return null
  const label = typeof subdomain === 'string' ? subdomainOfLabel(subdomain) : null
  if (label === null) return null
  const parsedServe = parseServe(serve)
  if (parsedServe === null) return null
  return { artifactId, subdomain: label, name, serve: parsedServe }
}

export const createRouteFetcher =
  (bucket: ArtifactBucket): RouteObjectFetcher =>
  async (subdomain) => {
    try {
      const object = await bucket.get(routePathOf({ id: subdomain }))
      if (object === null) return null
      const route = parseRouteObject(JSON.parse(await object.text()))
      return route === null || route.subdomain !== subdomain ? null : route
    } catch {
      return null
    }
  }

export const createObjectFetcher =
  (bucket: ArtifactBucket): ObjectFetcher =>
  async (key) => {
    try {
      const object = await bucket.get(key)
      return object === null ? null : { body: object.body, etag: object.httpEtag }
    } catch {
      return null
    }
  }
