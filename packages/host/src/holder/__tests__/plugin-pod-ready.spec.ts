import { describe, expect, it } from 'bun:test'

import { EMPTY_POD, composePod, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { RemoteHello } from '../../calls/remote-calls'
import { watchDaemonReady } from '../plugin-pod'

const CTX = {} as PluginPodContext

type Heard = { ctx: PluginPodContext; hello: RemoteHello }

const rig = (bootId: () => string | undefined = () => undefined) => {
  const listeners = new Set<(hello: RemoteHello) => void>()
  const heard: Heard[] = []
  const pod = composePod([
    { ...EMPTY_POD, onDaemonReady: (args) => void heard.push(args) },
    {
      ...EMPTY_POD,
      onDaemonReady: (args) => void heard.push({ ctx: args.ctx, hello: { ...args.hello } }),
    },
  ])
  const abort = new AbortController()
  watchDaemonReady({
    onReady: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    bootId,
    pod,
    ctx: CTX,
    signal: abort.signal,
  })
  const say = (hello: RemoteHello): void => {
    for (const listener of [...listeners]) listener(hello)
  }
  return { heard, say, abort, listeners }
}

describe('watching the daemon link for a ready pod', () => {
  it('tells every pod the boot id and whether the daemon restarted', () => {
    const { heard, say } = rig()
    say({ bootId: 'boot-2', restart: true })
    expect(heard).toEqual([
      { ctx: CTX, hello: { bootId: 'boot-2', restart: true } },
      { ctx: CTX, hello: { bootId: 'boot-2', restart: true } },
    ])
  })

  it('fires on the first hello too, which is what a fresh pod needs', () => {
    const { heard, say } = rig()
    say({ bootId: 'boot-1', restart: false })
    expect(heard.map((one) => one.hello)).toEqual([
      { bootId: 'boot-1', restart: false },
      { bootId: 'boot-1', restart: false },
    ])
  })

  it('tells a pod that subscribes after the link is already up', () => {
    const { heard } = rig(() => 'boot-1')
    expect(heard.map((one) => one.hello)).toEqual([
      { bootId: 'boot-1', restart: false },
      { bootId: 'boot-1', restart: false },
    ])
  })

  it('announces one daemon boot once, however often the link flaps', () => {
    const { heard, say } = rig()
    say({ bootId: 'boot-1', restart: false })
    say({ bootId: 'boot-1', restart: false })
    say({ bootId: 'boot-2', restart: true })
    expect(heard.map((one) => one.hello)).toEqual([
      { bootId: 'boot-1', restart: false },
      { bootId: 'boot-1', restart: false },
      { bootId: 'boot-2', restart: true },
      { bootId: 'boot-2', restart: true },
    ])
  })

  it('stops listening when the holder lets the session go', () => {
    const { heard, say, abort, listeners } = rig()
    abort.abort()
    expect(listeners.size).toBe(0)
    say({ bootId: 'boot-2', restart: true })
    expect(heard).toEqual([])
  })
})
