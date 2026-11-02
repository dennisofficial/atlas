export const PREVIEW_ORIGINS_PATH = '/desktop/window/preview-origins'

export function previewOriginsOf(urls: readonly string[]): string[] {
  const origins = new Set<string>()
  for (const url of urls) {
    if (!URL.canParse(url)) continue
    const { origin, protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') origins.add(origin)
  }
  return [...origins].sort()
}

export async function postPreviewOrigins(origins: readonly string[]): Promise<boolean> {
  try {
    const response = await fetch(PREVIEW_ORIGINS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origins }),
    })
    return response.ok
  } catch {
    return false
  }
}
