'use client'

import { useParams } from 'next/navigation'

export type RouteParams = Readonly<Record<string, string | string[] | undefined>>

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function routeParamOf(params: RouteParams, name: string): string {
  const value = params[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`route parameter "${name}" is missing`)
  }
  return decode(value)
}

export function useRouteParam(name: string): string {
  return routeParamOf(useParams(), name)
}
