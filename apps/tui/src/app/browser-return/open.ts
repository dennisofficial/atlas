import { browserReturns, type ReturnStore } from '@dltech/atlas-client/browser-return'
import { stateOfStartLink } from '@dltech/atlas-core'

import type { LoopbackCopy } from '@dltech/atlas-client/loopback'
import {
  startLoopbackReturn,
  type LoopbackReturn,
  type LoopbackStart,
} from '@dltech/atlas-client/loopback'

export type OpenBrowserReturn = {
  url: string
  open: (url: string) => void
  copy: LoopbackCopy
}

export type BrowserReturnOpener = {
  open: (args: OpenBrowserReturn) => void
  stop: () => void
}

type ActiveReturn = { state: string; href: string; listener: LoopbackReturn }

export const createBrowserReturnOpener = (
  args: {
    start?: ((loopback: LoopbackStart) => LoopbackReturn) | undefined
    store?: ReturnStore
  } = {},
): BrowserReturnOpener => {
  const start = args.start ?? startLoopbackReturn
  const store = args.store ?? browserReturns
  let active: ActiveReturn | null = null

  const forget = (listener: LoopbackReturn): void => {
    if (active?.listener === listener) active = null
  }

  const open = (opened: OpenBrowserReturn): void => {
    const state = stateOfStartLink(opened.url)
    if (state === undefined) {
      opened.open(opened.url)
      return
    }
    if (active?.state === state) {
      opened.open(active.href)
      return
    }
    active?.listener.stop()
    active = null
    const listener = start({ url: opened.url, open: opened.open, copy: opened.copy })
    active = { state, href: listener.href, listener }
    void listener.outcome.then((outcome) => {
      forget(listener)
      if (outcome !== undefined) store.remember({ state, outcome })
    })
  }

  const stop = (): void => {
    active?.listener.stop()
    active = null
  }

  return { open, stop }
}

const defaultOpener = createBrowserReturnOpener()

export const openBrowserReturn = (args: OpenBrowserReturn): void => defaultOpener.open(args)

export const stopBrowserReturn = (): void => defaultOpener.stop()
