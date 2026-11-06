export const PREVIEW_CALLBACK_HOST = 'callback.byatlas.dev'

export const PREVIEW_CALLBACK_START_PATH = '/__atlas/start'

export const DESKTOP_PREVIEW_CALLBACK_HOST = 'preview-callback'

export const DESKTOP_PREVIEW_CALLBACK_EVENT = 'atlas-desktop:preview-callback'

export function previewCallbackStartOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  const redirect = parsed.searchParams.get('redirect_uri') ?? ''
  if (parsed.protocol !== 'https:' || !URL.canParse(redirect)) return null
  if (new URL(redirect).hostname !== PREVIEW_CALLBACK_HOST) return null
  const start = new URL(PREVIEW_CALLBACK_START_PATH, `https://${PREVIEW_CALLBACK_HOST}`)
  start.searchParams.set('to', url)
  return start.toString()
}
