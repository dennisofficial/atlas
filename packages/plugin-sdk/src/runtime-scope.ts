import type { PluginPodContext } from './slots'

export type PodRuntimeContext = Pick<
  PluginPodContext,
  'call' | 'live' | 'log' | 'onDaemonEvent'
> & {
  onReset(listener: () => void): void
  onDispose(listener: () => void): void
}

export class PodRuntimeScope {
  private readonly values = new Map<unknown, unknown>()
  private readonly resets = new Set<() => void>()
  private readonly disposals = new Set<() => void>()
  private disposed = false
  private readonly context: PodRuntimeContext

  constructor(ports: Pick<PluginPodContext, 'call' | 'live' | 'log' | 'onDaemonEvent'>) {
    this.context = {
      ...ports,
      onDaemonEvent: (listener) => {
        const off = ports.onDaemonEvent(listener)
        this.disposals.add(off)
        return off
      },
      onReset: (listener) => void this.resets.add(listener),
      onDispose: (listener) => void this.disposals.add(listener),
    }
  }

  shared<T>(factory: (context: PodRuntimeContext) => T): T {
    if (this.disposed) throw new Error('the plugin runtime scope was disposed')
    if (this.values.has(factory)) return this.values.get(factory) as T
    const value = factory(this.context)
    this.values.set(factory, value)
    return value
  }

  reset(): void {
    if (this.disposed) return
    for (const reset of this.resets) reset()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposals) dispose()
    this.disposals.clear()
    this.resets.clear()
    this.values.clear()
  }
}
