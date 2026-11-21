import net from 'node:net'

import type { LinkProfile } from './profiles'
import { seededRandom } from './rng'
import { shapedDirection } from './shaper'

const STALL_TICK_MS = 1_000

export type ProxyStats = { bytesDown: number; bytesUp: number; stalls: number; stallMs: number }

export type ShapingProxy = {
  port: number
  url: string
  stats: ProxyStats
  close(): void
}

const toBuffer = (chunk: string | Buffer): Buffer =>
  typeof chunk === 'string' ? Buffer.from(chunk) : chunk

const stallLengthOf = (args: { profile: LinkProfile; random: () => number }): number => {
  const random = args.profile.randomStall
  if (random === undefined) return args.profile.fixedStall?.ms ?? 0
  return Math.round(random.minMs + args.random() * (random.maxMs - random.minMs))
}

export const createShapingProxy = (args: {
  profile: LinkProfile
  upstreamPort: number
  seed: number
  onStall?: (() => void) | undefined
}): ShapingProxy => {
  const random = seededRandom(args.seed)
  const stats: ProxyStats = { bytesDown: 0, bytesUp: 0, stalls: 0, stallMs: 0 }
  const sockets = new Set<net.Socket>()
  let stallUntil = 0
  let stalls = 0
  let fixedStallArmed = false

  const paused = (): boolean => Date.now() < stallUntil

  const startStall = (ms: number): void => {
    stallUntil = Date.now() + ms
    stalls += 1
    stats.stalls = stalls
    stats.stallMs += ms
    args.onStall?.()
  }

  const stallTimer = setInterval(() => {
    if (paused()) return
    if (stats.bytesDown === 0 && stats.bytesUp === 0) return
    const fixed = args.profile.fixedStall
    if (fixed !== undefined) {
      if (!fixedStallArmed) {
        fixedStallArmed = true
        startStall(fixed.ms)
      }
      return
    }
    if (args.profile.randomStall === undefined) return
    if (random() >= args.profile.randomStall.probabilityPerSecond) return
    startStall(stallLengthOf({ profile: args.profile, random }))
  }, STALL_TICK_MS)

  const server = net.createServer((client) => {
    const upstream = net.connect({ host: '127.0.0.1', port: args.upstreamPort })
    sockets.add(client)
    sockets.add(upstream)
    const down = shapedDirection({
      write: (chunk) => client.write(chunk),
      latencyMs: args.profile.latencyMs,
      bytesPerSecond: args.profile.bytesPerSecond,
      paused,
      countBytes: (bytes) => {
        stats.bytesDown += bytes
      },
    })
    const up = shapedDirection({
      write: (chunk) => upstream.write(chunk),
      latencyMs: args.profile.latencyMs,
      bytesPerSecond: args.profile.bytesPerSecond,
      paused,
      countBytes: (bytes) => {
        stats.bytesUp += bytes
      },
    })
    client.on('data', (chunk) => up.push(toBuffer(chunk)))
    upstream.on('data', (chunk) => down.push(toBuffer(chunk)))
    const teardown = (): void => {
      down.close()
      up.close()
      sockets.delete(client)
      sockets.delete(upstream)
      client.destroy()
      upstream.destroy()
    }
    client.on('close', teardown)
    client.on('error', teardown)
    upstream.on('close', teardown)
    upstream.on('error', teardown)
  })

  server.listen(0, '127.0.0.1')
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stats,
    close: () => {
      clearInterval(stallTimer)
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      server.close()
    },
  }
}
