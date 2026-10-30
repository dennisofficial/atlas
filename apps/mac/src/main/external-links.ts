export enum ENavigationTarget {
  InApp = 'in-app',
  External = 'external',
}

export function decideNavigation({
  url,
  hostOrigin,
  frameOrigins = [],
}: {
  url: string
  hostOrigin: string
  frameOrigins?: readonly string[]
}): ENavigationTarget {
  if (url === 'about:blank') return ENavigationTarget.InApp
  try {
    const { origin } = new URL(url)
    if (origin === hostOrigin || frameOrigins.includes(origin)) return ENavigationTarget.InApp
    return ENavigationTarget.External
  } catch {
    return ENavigationTarget.External
  }
}

// Electrobun 2.0.5 applies navigation rules to iframe loads too (decidePolicyForNavigationAction
// never checks targetFrame.isMainFrame), so origins the preview iframe shows must be allowed here.
export function navigationRulesFor({
  hostOrigin,
  frameOrigins = [],
}: {
  hostOrigin: string
  frameOrigins?: readonly string[]
}): string[] {
  return ['^*', `${hostOrigin}/*`, ...frameOrigins.map((origin) => `${origin}/*`), 'about:blank']
}

// Electrobun 2.0.5 native payloads: will-navigate sends a JSON string, new-window-open an object.
// https://github.com/blackboardsh/electrobun/blob/main/package/src/native/macos/nativeWrapper.mm
export function navigationUrlOf(event: unknown): string | null {
  const detail = (event as { data?: { detail?: unknown } } | null)?.data?.detail
  const payload = typeof detail === 'string' ? safeParse(detail) : detail
  const url = (payload as { url?: unknown } | null)?.url
  return typeof url === 'string' ? url : null
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
