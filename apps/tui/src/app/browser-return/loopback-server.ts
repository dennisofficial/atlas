import {
  EReturnSurface,
  LOOPBACK_HOST,
  LOOPBACK_TIMEOUT_MS,
  loopbackReplyOf,
  startLinkFor,
  stateOfStartLink,
  type ReturnOutcome,
} from '@dltech/atlas-core'

import { loopbackPageOf, type LoopbackCopy } from './loopback-page'

const NOT_FOUND = 404

const OK = 200

const NOT_FOUND_BODY = 'not found'

const HTML = 'text/html; charset=utf-8'

export type LoopbackStart = {
  url: string
  open: (url: string) => void
  copy: LoopbackCopy
  timeoutMs?: number | undefined
}

export type LoopbackReturn = {
  port: number
  href: string
  outcome: Promise<ReturnOutcome | undefined>
  stop: () => void
}

export const startLoopbackReturn = (args: LoopbackStart): LoopbackReturn => {
  const state = stateOfStartLink(args.url)
  if (state === undefined) throw new Error('a loopback return needs a start link to open')

  let settle: (outcome: ReturnOutcome | undefined) => void = () => undefined
  const outcome = new Promise<ReturnOutcome | undefined>((resolve) => {
    settle = resolve
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let port = 0

  const close = (settled: ReturnOutcome | undefined): void => {
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
      const reply = loopbackReplyOf({
        method: request.method,
        address: host.requestIP(request)?.address,
        url: request.url,
        port,
        state,
      })
      if (!reply.accepted) return new Response(NOT_FOUND_BODY, { status: NOT_FOUND })
      const page = loopbackPageOf({ copy: args.copy, outcome: reply.outcome })
      close(reply.outcome)
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
  const href = startLinkFor({ url: args.url, surface: EReturnSurface.Tui, port })

  timer = setTimeout(() => close(undefined), args.timeoutMs ?? LOOPBACK_TIMEOUT_MS)
  timer.unref?.()
  args.open(href)

  return { port, href, outcome, stop: () => close(undefined) }
}
