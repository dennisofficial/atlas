import { describe, expect, it } from 'bun:test'

import { unimplementedSubscriptions } from '../../stream/subscription-port'
import { HostStartupService } from '../startup.service'
import type { StreamStartArgs } from '../stream-service'

const hostWatch = () => ({ recompute: () => undefined, close: async () => undefined })

describe('HostStartupService', () => {
  it('starts the holder, then the watch, then the follow stack and the stream', async () => {
    const calls: string[] = []
    const subscriptions = { ...unimplementedSubscriptions, close: () => undefined }
    let hostId: number | undefined = 7
    let selfId: (() => number | undefined) | undefined
    let ring: (() => void) | undefined
    let started: StreamStartArgs | undefined

    const service = new HostStartupService({
      holder: {
        start: async () => {
          calls.push('holder.start')
        },
        hostId: () => hostId,
        ring: () => {
          calls.push('holder.ring')
        },
      },
      watch: {
        start: (args) => {
          calls.push('watch.start')
          selfId = args.selfId
          ring = args.ring
          return hostWatch()
        },
      },
      follow: {
        open: () => {
          calls.push('follow.open')
          return subscriptions
        },
      },
      stream: {
        start: (args) => {
          calls.push('stream.start')
          started = args
          return {
            port: 10_000,
            connections: () => 0,
            drain: async () => undefined,
            stop: async () => undefined,
          }
        },
      },
    })

    await service.onApplicationBootstrap()

    expect(calls).toEqual(['holder.start', 'watch.start', 'follow.open', 'stream.start'])
    expect(started?.subscriptions).toBe(subscriptions)

    expect(selfId?.()).toBe(7)
    hostId = 9
    expect(selfId?.()).toBe(9)
    ring?.()
    expect(calls).toContain('holder.ring')
  })

  it('starts nothing else when the holder refuses to start', async () => {
    const calls: string[] = []

    const service = new HostStartupService({
      holder: {
        start: async () => {
          calls.push('holder.start')
          throw new Error('no host')
        },
        hostId: () => undefined,
        ring: () => undefined,
      },
      watch: {
        start: () => {
          calls.push('watch.start')
          return hostWatch()
        },
      },
      follow: {
        open: () => {
          calls.push('follow.open')
          return { ...unimplementedSubscriptions, close: () => undefined }
        },
      },
      stream: {
        start: () => {
          calls.push('stream.start')
          return {
            port: 10_000,
            connections: () => 0,
            drain: async () => undefined,
            stop: async () => undefined,
          }
        },
      },
    })

    await expect(service.onApplicationBootstrap()).rejects.toThrow('no host')
    expect(calls).toEqual(['holder.start'])
  })
})
