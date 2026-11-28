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

export type LoopbackListenerSpec<T> = {
  path: string
  hosts?: readonly string[] | undefined
  readReturn: (url: string) => LoopbackAccepted<T> | undefined
}

export type LoopbackSpec<T> = LoopbackListenerSpec<T> & {
  state: string
  hrefOf: (port: number) => string
}

type LoopbackServe = {
  open: (url: string) => void
  copy: LoopbackCopy
  timeoutMs?: number | undefined
}

export type LoopbackStart = LoopbackServe & { url: string }

export type LoopbackWait<T> = LoopbackServe & { spec: LoopbackSpec<T> }

export type LoopbackListener<T> = {
  port: number
  outcome: Promise<T | undefined>
  stop: () => void
}

export type LoopbackBind<T> = {
  copy: LoopbackCopy
  port?: number | undefined
  timeoutMs?: number | undefined
  spec: LoopbackListenerSpec<T>
}

export type LoopbackReturn<T = ReturnOutcome> = LoopbackListener<T> & { href: string }

export const startLoopbackListener = <T>(args: LoopbackBind<T>): LoopbackListener<T> => {
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
    port: args.port ?? 0,
    fetch: (request, host) => {
      const address = host.requestIP(request)?.address
      if (
        !loopbackRequestOk({
          method: request.method,
          address,
          url: request.url,
          port,
          path: spec.path,
          ...(spec.hosts === undefined ? {} : { hosts: spec.hosts }),
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
  timer = setTimeout(() => close(undefined), args.timeoutMs ?? LOOPBACK_TIMEOUT_MS)
  timer.unref?.()

  return { port, outcome, stop: () => close(undefined) }
}

const serveLoopback = <T>(args: LoopbackServe & { spec: LoopbackSpec<T> }): LoopbackReturn<T> => {
  const { spec } = args
  const listener = startLoopbackListener({
    copy: args.copy,
    spec,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })
  let href: string
  try {
    href = spec.hrefOf(listener.port)
  } catch (error) {
    listener.stop()
    throw error
  }

  let launched: unknown
  try {
    launched = args.open(href)
  } catch (error) {
    listener.stop()
    throw error
  }

  void Promise.resolve(launched).then(
    (started) => {
      if (started === false) listener.stop()
    },
    () => listener.stop(),
  )

  return { port: listener.port, href, outcome: listener.outcome, stop: listener.stop }
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
