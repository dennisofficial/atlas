import { DESKTOP_NAVIGATE_EVENT, isInAppPath } from '@dltech/atlas-wire/web'

export function navigateScript(path: string): string | null {
  if (!isInAppPath(path)) return null
  const event = JSON.stringify(DESKTOP_NAVIGATE_EVENT)
  return `window.dispatchEvent(new CustomEvent(${event}, { detail: ${JSON.stringify(path)} }))`
}
