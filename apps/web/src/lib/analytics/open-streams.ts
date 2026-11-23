export interface OpenStreamCounter {
  count: () => number
}

export function installOpenStreamCounter(host: {
  EventSource?: typeof EventSource | undefined
}): OpenStreamCounter {
  const Native = host.EventSource
  if (Native === undefined) return { count: () => 0 }
  const open = new Set<EventSource>()

  class CountedEventSource extends Native {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init)
      open.add(this)
    }

    override close(): void {
      open.delete(this)
      super.close()
    }
  }

  host.EventSource = CountedEventSource
  return {
    count: () => {
      for (const source of open) {
        if (source.readyState === Native.CLOSED) open.delete(source)
      }
      return open.size
    },
  }
}
