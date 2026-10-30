const VIEWPORT = { width: 800, height: 600 }
const ITEM_HEIGHT = 80

const sizeOf = (target: Element) =>
  target.getAttribute('data-slot') === 'chat-viewport' ? VIEWPORT.height : ITEM_HEIGHT

class SizedResizeObserver {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    const height = sizeOf(target)
    const entry = {
      target,
      contentRect: { width: VIEWPORT.width, height },
    } as unknown as ResizeObserverEntry
    queueMicrotask(() => this.callback([entry], this as unknown as ResizeObserver))
  }

  unobserve() {}

  disconnect() {}
}

export function installVirtuaViewport() {
  const previous = globalThis.ResizeObserver
  globalThis.ResizeObserver = SizedResizeObserver as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentElement
    },
  })
  return () => {
    globalThis.ResizeObserver = previous
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
  }
}
