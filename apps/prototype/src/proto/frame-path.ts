const CHROME_ROUTE = '/proto'

export function splitFramePath(path: string): { pathname: string; search: string } {
  const queryStart = path.indexOf('?')
  if (queryStart === -1) return { pathname: path, search: '' }
  return { pathname: path.slice(0, queryStart), search: path.slice(queryStart + 1) }
}

export function safeFramePath({
  raw,
  fallback,
}: {
  raw: string | undefined
  fallback: string
}): string {
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  const { pathname } = splitFramePath(raw)
  const isChromeRoute = pathname === CHROME_ROUTE || pathname.startsWith(`${CHROME_ROUTE}/`)
  return isChromeRoute ? fallback : raw
}

export function chromeUrl({ path, viewport }: { path: string; viewport: string }): string {
  return `${CHROME_ROUTE}?path=${encodeURIComponent(path)}&vp=${viewport}`
}

export function joinPath({ pathname, search }: { pathname: string; search: string }): string {
  return search ? `${pathname}?${search}` : pathname
}
