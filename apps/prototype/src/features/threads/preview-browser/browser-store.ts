import { usePathname } from 'next/navigation'
import { useCallback, useSyncExternalStore } from 'react'

import { SESSION_THREAD_ID } from '../../shell/fixtures/app'
import { activeThreadIdOf } from '../../shell/active-route'
import { browserOf, NEW_TAB_URL, type BrowserState } from './browser-model'
import { siteByPort, siteUrl, type PreviewSite } from './preview-sites'

const NO_THREAD = 'new'

const states = new Map<string, BrowserState>()
const listeners = new Set<() => void>()

const urlOf = (args: { port: number; path: string }): string => {
  const site: PreviewSite | undefined = siteByPort(args.port)
  return site ? siteUrl({ site, path: args.path }) : NEW_TAB_URL
}

function seedFor(threadId: string): BrowserState {
  if (threadId !== SESSION_THREAD_ID) return browserOf({ histories: [[NEW_TAB_URL]] })
  return browserOf({
    histories: [
      [urlOf({ port: 3000, path: '/' }), urlOf({ port: 3000, path: '/dashboard' })],
      [urlOf({ port: 6006, path: '/?path=/story/button' })],
      [urlOf({ port: 3000, path: '/prototype/rep-routing' })],
    ],
  })
}

function stateOf(threadId: string): BrowserState {
  const held = states.get(threadId)
  if (held) return held
  const seeded = seedFor(threadId)
  states.set(threadId, seeded)
  return seeded
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useThreadKey(): string {
  return activeThreadIdOf(usePathname()) ?? NO_THREAD
}

export function usePreviewBrowser(threadId: string) {
  const read = useCallback(() => stateOf(threadId), [threadId])
  const state = useSyncExternalStore(subscribe, read, read)
  const update = useCallback(
    (change: (state: BrowserState) => BrowserState) => {
      states.set(threadId, change(stateOf(threadId)))
      for (const listener of listeners) listener()
    },
    [threadId],
  )
  return { state, update }
}
