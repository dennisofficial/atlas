export const STATIC_EXPORT_PLACEHOLDER = '_'

export function routeIdAfter({ pathname, segment }: { pathname: string; segment: string }): string {
  const parts = pathname.split('/').filter((part) => part.length > 0)
  const id = parts[parts.indexOf(segment) + 1]
  return id === undefined ? STATIC_EXPORT_PLACEHOLDER : decodeURIComponent(id)
}

export function staticParamsForDesktop<T extends Record<string, string>>(param: T): T[] {
  return process.env.ATLAS_WEB_TARGET === 'desktop' ? [param] : []
}
