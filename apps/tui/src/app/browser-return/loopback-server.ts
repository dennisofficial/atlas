import {
  EReturnSurface,
  LOOPBACK_HOST,
  LOOPBACK_PATH,
  LOOPBACK_TIMEOUT_MS,
  browserReturnOf,
  loopbackRequestOk,
  startLinkFor,
  stateOfStartLink,
  type ReturnOutcome,
} from '@dltech/atlas-core'

import { loopbackPageOf, type LoopbackCopy } from './loopback-page'

const NOT_FOUND = 404

const OK = 200

const NOT_FOUND_BODY = 'not found'

const HTML = 'text/html; charset=utf-8'

export type LoopbackAccepted<T> = { page: ReturnOutcome; value: T }

export type LoopbackSpec<T> = {
  state: string
  path: string
  hrefOf: (port: number) => string
  readReturn: (url: string) => LoopbackAccepted<T> | undefined
}

type LoopbackServe = {
  open: (url: string) => void
  copy: LoopbackCopy
  timeoutMs?: number | undefined
}

export type LoopbackStart = LoopbackServe & { url: string }

export type LoopbackWait<T> = LoopbackServe & { spec: LoopbackSpec<T> }

export type LoopbackReturn<T = ReturnOutcome> = {
  port: number
  href: string
  outcome: Promise<T | undefined>
  stop: () => void
}

const serveLoopback = <T>(args: LoopbackServe & { spec: LoopbackSpec<T> }): LoopbackReturn<T> => {
  const { spec } = args
  let settle: (value: T | undefined) => void = () => undefined
  const outcome = new Promise<T | undefined>((resolve) => {
    settle = resolve
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let port = 0

  const close = (settled: T | undefined): void => {
    if (closed) return
    closed = true
    if (timer !== null) clearTimeout(timer)
    void server.stop()
    settle(settled)
  }

  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: 0,
    fetch: (request, host) => {
      const address = host.requestIP(request)?.address
      if (
        !loopbackRequestOk({
          method: request.method,
          address,
          url: request.url,
          port,
          path: spec.path,
        })
      )
        return new Response(NOT_FOUND_BODY, { status: NOT_FOUND })
      const accepted = spec.readReturn(request.url)
      if (accepted === undefined) return new Response(NOT_FOUND_BODY, { status: NOT_FOUND })
      const page = loopbackPageOf({ copy: args.copy, outcome: accepted.page })
      close(accepted.value)
      return new Response(page, { status: OK, headers: { 'content-type': HTML } })
    },
  })
  server.unref()

  const boundPort = server.port
  if (boundPort === undefined) {
    close(undefined)
    throw new Error('the loopback return bound no port')
  }
  port = boundPort
  const href = spec.hrefOf(port)

  timer = setTimeout(() => close(undefined), args.timeoutMs ?? LOOPBACK_TIMEOUT_MS)
  timer.unref?.()
  args.open(href)

  return { port, href, outcome, stop: () => close(undefined) }
}

const cardSpecOf = (args: LoopbackStart): LoopbackSpec<ReturnOutcome> => {
  const state = stateOfStartLink(args.url)
  if (state === undefined) throw new Error('a loopback return needs a start link to open')

  return {
    state,
    path: LOOPBACK_PATH,
    hrefOf: (port) => startLinkFor({ url: args.url, surface: EReturnSurface.Tui, port }),
    readReturn: (url) => {
      const returned = browserReturnOf(url)
      if (returned === undefined || returned.state !== state) return undefined
      return { page: returned.outcome, value: returned.outcome }
    },
  }
}

export const startLoopbackReturn = (args: LoopbackStart): LoopbackReturn<ReturnOutcome> =>
  serveLoopback({ ...args, spec: cardSpecOf(args) })

export const startLoopbackWait = <T>(args: LoopbackWait<T>): LoopbackReturn<T> =>
  serveLoopback({ open: args.open, copy: args.copy, timeoutMs: args.timeoutMs, spec: args.spec })
