import type { PageMessage } from './bridge-messages'

export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

export function postToParent(message: PageMessage) {
  if (!isEmbedded()) return
  window.parent.postMessage(message, window.location.origin)
}

export function isFromParent(event: MessageEvent): boolean {
  return event.source === window.parent && event.origin === window.location.origin
}
