export enum ENavigationTarget {
  InApp = 'in-app',
  External = 'external',
}

export function decideNavigation({
  url,
  hostOrigin,
}: {
  url: string
  hostOrigin: string
}): ENavigationTarget {
  if (url === 'about:blank') return ENavigationTarget.InApp
  try {
    return new URL(url).origin === hostOrigin ? ENavigationTarget.InApp : ENavigationTarget.External
  } catch {
    return ENavigationTarget.External
  }
}

export function navigationRulesFor({ hostOrigin }: { hostOrigin: string }): string[] {
  return ['^*', `${hostOrigin}/*`, 'about:blank']
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
