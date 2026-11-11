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
export type ObjectFetcher = (key: string) => Promise<Response | null>

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

const objectUrlOf = ({ baseUrl, path }: { baseUrl: string; path: string }): string =>
  `${baseUrl.replace(/\/+$/, '')}/${path}`

export const createRouteFetcher =
  (baseUrl: string): RouteObjectFetcher =>
  async (subdomain) => {
    try {
      const response = await fetch(objectUrlOf({ baseUrl, path: routePathOf({ id: subdomain }) }), {
        cache: 'no-store',
      })
      if (!response.ok) return null
      const route = parseRouteObject(await response.json())
      return route === null || route.subdomain !== subdomain ? null : route
    } catch {
      return null
    }
  }

export const createObjectFetcher =
  (baseUrl: string): ObjectFetcher =>
  async (key) => {
    try {
      const response = await fetch(objectUrlOf({ baseUrl, path: key }))
      return response.ok ? response : null
    } catch {
      return null
    }
  }
