import { browserSlotEnvironment, type SlotEnvironment } from '../placement'
import type { PaneCommand, PaneRect } from './pane-command'
import { coveredOf, sameRect, windowRectOf, type SamplePoint } from './pane-geometry'
import { notePaneLocation, paneLocationOf } from './pane-locations'

export type PaneSender = (command: PaneCommand) => Promise<boolean>

export type PaneEnvironment = SlotEnvironment & {
  requestFrame: (run: () => void) => number
  cancelFrame: (handle: number) => void
  topAt: (point: SamplePoint) => Element | null
  observeDocument: (onChange: () => void) => () => void
}

export const browserPaneEnvironment: PaneEnvironment = {
  ...browserSlotEnvironment,
  requestFrame: (run) => requestAnimationFrame(() => run()),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  topAt: ({ x, y }) => document.elementFromPoint(x, y),
  observeDocument: (onChange) => {
    const observer = new MutationObserver(onChange)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    })
    return () => observer.disconnect()
  },
}

export type PaneSync = { apply: (url: string) => void; stop: () => void }

const MEASURE_EVENTS = ['scroll', 'resize'] as const

const requestedUrlByTarget = new Map<string, string>()

export function createPaneSync(args: {
  element: HTMLElement
  id: string
  url: string
  send: PaneSender
  environment?: PaneEnvironment | undefined
}): PaneSync {
  const { element, send, environment = browserPaneEnvironment } = args
  let url = args.url
  let shown = false
  let sent: PaneRect | undefined
  let pending: PaneRect | undefined
  let frame: number | undefined
  let inFlight = false
  let queued: PaneCommand | undefined
  let obscured = false
  let stopped = false

  const deliver = (command: PaneCommand): void => {
    if (stopped && command.kind !== 'hide') return
    if (inFlight) {
      queued = command
      return
    }
    inFlight = true
    void send(command)
      .catch(() => false)
      .then(() => {
        inFlight = false
        const next = queued
        queued = undefined
        if (next !== undefined) deliver(next)
      })
  }

  const alreadyAt = (target: string): boolean => paneLocationOf(args.id) === target

  const requestNavigation = (target: string): void => {
    requestedUrlByTarget.set(args.id, target)
    notePaneLocation({ id: args.id, url: target })
    deliver({ kind: 'navigate', url: target })
  }

  const probe = (): void => {
    if (stopped || !shown || sent === undefined) return
    const next = coveredOf({ slot: element, rect: sent, topAt: environment.topAt })
    if (next === obscured) return
    obscured = next
    deliver({ kind: 'setObscured', obscured: next })
  }

  const flush = (): void => {
    frame = undefined
    const rect = pending
    pending = undefined
    if (rect !== undefined && !sameRect(sent, rect)) {
      sent = rect
      deliver({ kind: 'setRect', rect })
    }
    probe()
  }

  const schedule = (): void => {
    if (stopped || frame !== undefined) return
    frame = environment.requestFrame(flush)
  }

  const measure = (): void => {
    if (stopped) return
    const rect = windowRectOf(element)
    if (rect.width <= 0 || rect.height <= 0) return
    if (!shown) {
      shown = true
      sent = rect
      const previous = requestedUrlByTarget.get(args.id)
      deliver({ kind: 'show', url, rect })
      const moved = previous !== undefined && previous !== url
      if (moved && !alreadyAt(url)) requestNavigation(url)
      requestedUrlByTarget.set(args.id, url)
      probe()
      return
    }
    if (pending === undefined && sameRect(sent, rect)) return
    pending = rect
    schedule()
  }

  const stops = [
    environment.observeResize({ element, onResize: measure }),
    ...MEASURE_EVENTS.map((type) => environment.listen({ type, onEvent: measure })),
    environment.observeDocument(schedule),
  ]

  measure()

  return {
    apply: (next) => {
      if (stopped || next === url) return
      url = next
      if (!shown) return
      if (alreadyAt(next)) {
        requestedUrlByTarget.set(args.id, next)
        return
      }
      requestNavigation(next)
    },
    stop: () => {
      if (stopped) return
      stopped = true
      if (frame !== undefined) environment.cancelFrame(frame)
      frame = undefined
      for (const stop of stops) stop()
      deliver({ kind: 'hide' })
    },
  }
}
