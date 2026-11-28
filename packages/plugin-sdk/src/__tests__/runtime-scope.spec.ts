import { describe, expect, it } from 'bun:test'

import { PodRuntimeScope, type PodRuntimeContext } from '../runtime-scope'

const rig = () => {
  const listeners = new Set<Parameters<PodRuntimeContext['onDaemonEvent']>[0]>()
  const scope = new PodRuntimeScope({
    call: async () => {
      throw new Error('unexpected call')
    },
    live: () => undefined,
    log: () => undefined,
    onDaemonEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  })
  return { scope, listeners }
}

describe('a plugin runtime resource scope', () => {
  it('creates each resource once per runtime, not once per context or session id', () => {
    const first = rig()
    const second = rig()
    let created = 0
    const resource = () => ({ id: ++created })
    expect(first.scope.shared(resource)).toBe(first.scope.shared(resource))
    expect(second.scope.shared(resource)).not.toBe(first.scope.shared(resource))
    expect(created).toBe(2)
  })

  it('resets resources without multiplying their daemon subscriptions', () => {
    const { scope, listeners } = rig()
    let resets = 0
    const resource = (ctx: PodRuntimeContext) => {
      ctx.onReset(() => {
        resets += 1
      })
      ctx.onDaemonEvent(() => undefined)
      return {}
    }
    const value = scope.shared(resource)
    scope.reset()
    scope.reset()
    expect(resets).toBe(2)
    expect(scope.shared(resource)).toBe(value)
    expect(listeners.size).toBe(1)
  })

  it('disposes once, unsubscribes, and refuses resource creation after release', () => {
    const { scope, listeners } = rig()
    let disposed = 0
    scope.shared((ctx) => {
      ctx.onDispose(() => {
        disposed += 1
      })
      ctx.onDaemonEvent(() => undefined)
    })
    scope.dispose()
    scope.dispose()
    scope.reset()
    expect(disposed).toBe(1)
    expect(listeners.size).toBe(0)
    expect(() => scope.shared(() => ({}))).toThrow('disposed')
  })
})
