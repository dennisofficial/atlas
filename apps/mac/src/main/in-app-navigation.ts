import {
  DESKTOP_NAVIGATE_EVENT,
  DESKTOP_PREVIEW_CALLBACK_EVENT,
  isInAppPath,
} from '@dltech/atlas-wire/web'

export const RELOAD_SCRIPT = 'window.location.reload()'

function dispatchScript(args: { event: string; path: string }): string | null {
  if (!isInAppPath(args.path)) return null
  const detail = JSON.stringify(args.path)
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(args.event)}, { detail: ${detail} }))`
}

export const navigateScript = (path: string): string | null =>
  dispatchScript({ event: DESKTOP_NAVIGATE_EVENT, path })

export const previewCallbackScript = (path: string): string | null =>
  dispatchScript({ event: DESKTOP_PREVIEW_CALLBACK_EVENT, path })
