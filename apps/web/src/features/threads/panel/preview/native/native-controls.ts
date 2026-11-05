import { useSyncExternalStore } from 'react'

import type { NativeWebview, NavState } from './webview-handle'

const webviews = new Map<string, NativeWebview>()
let navs: Readonly<Record<string, NavState>> = {}
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

export function registerWebview(args: { key: string; webview: NativeWebview }): () => void {
  const { key, webview } = args
  webviews.set(key, webview)
  notify()
  return () => {
    if (webviews.get(key) !== webview) return
    webviews.delete(key)
    navs = Object.fromEntries(Object.entries(navs).filter(([held]) => held !== key))
    notify()
  }
}

export const webviewOf = (key: string): NativeWebview | undefined => webviews.get(key)

export function setNavState(args: { key: string; state: NavState }): void {
  const { key, state } = args
  const held = navs[key]
  if (held?.canGoBack === state.canGoBack && held.canGoForward === state.canGoForward) return
  navs = { ...navs, [key]: state }
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useNativeNav = (key: string): NavState | undefined =>
  useSyncExternalStore(
    subscribe,
    () => navs[key],
    () => undefined,
  )
