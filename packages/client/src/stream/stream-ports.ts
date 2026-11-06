export type StreamSocket = {
  send(data: string): void
  close(code?: number): void
}

export type StreamSocketHandlers = {
  handleOpen(): void
  handleMessage(data: string): void
  handleClose(code: number): void
}

export type StreamSocketFactory = (args: {
  url: string
  handlers: StreamSocketHandlers
}) => StreamSocket

export type StreamScheduler = {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  random(): number
}

export const browserStreamSocket: StreamSocketFactory = ({ url, handlers }) => {
  const socket = new WebSocket(url)
  socket.onopen = () => handlers.handleOpen()
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.handleMessage(event.data)
  }
  socket.onclose = (event) => handlers.handleClose(event.code)

  return {
    send: (data) => socket.send(data),
    close: (code) => socket.close(code),
  }
}

export const systemStreamScheduler: StreamScheduler = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: () => Math.random(),
}

export type StreamNetworkSignal = (handleSignal: () => void) => () => void

type SignalWindow = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

type SignalDocument = SignalWindow & { readonly visibilityState: string }

export const networkSignalOf =
  (args: { win: SignalWindow | undefined; doc: SignalDocument | undefined }): StreamNetworkSignal =>
  (handleSignal) => {
    const { win, doc } = args
    if (win === undefined || doc === undefined) return () => {}
    const handleVisibility = (): void => {
      if (doc.visibilityState === 'visible') handleSignal()
    }
    win.addEventListener('online', handleSignal)
    doc.addEventListener('visibilitychange', handleVisibility)
    return () => {
      win.removeEventListener('online', handleSignal)
      doc.removeEventListener('visibilitychange', handleVisibility)
    }
  }

export const browserNetworkSignal: StreamNetworkSignal = (handleSignal) =>
  networkSignalOf({
    win: typeof globalThis.addEventListener === 'function' ? globalThis : undefined,
    doc: typeof document === 'undefined' ? undefined : document,
  })(handleSignal)
