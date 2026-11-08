export type DaemonSocket = {
  send(text: string): void
  close(): void
}

export type DaemonLinkHandlers = {
  onText(text: string): void
  onClose(code: number, reason: string): void
  signal: AbortSignal
}

export type DaemonConnector = (handlers: DaemonLinkHandlers) => Promise<DaemonSocket>

export const webSocketConnector =
  (args: { url: string }): DaemonConnector =>
  (handlers) =>
    new Promise<DaemonSocket>((resolve, reject) => {
      if (handlers.signal.aborted) {
        reject(new Error(`websocket to ${args.url} was abandoned before opening`))
        return
      }
      const socket = new WebSocket(args.url)
      let opened = false
      const handleAbort = (): void => {
        socket.close()
        reject(new Error(`websocket to ${args.url} was abandoned before opening`))
      }
      handlers.signal.addEventListener('abort', handleAbort, { once: true })
      socket.addEventListener('open', () => {
        opened = true
        handlers.signal.removeEventListener('abort', handleAbort)
        resolve({
          send: (text) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(text)
          },
          close: () => socket.close(),
        })
      })
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') handlers.onText(event.data)
      })
      socket.addEventListener('error', () => {
        if (opened) return
        handlers.signal.removeEventListener('abort', handleAbort)
        reject(new Error(`websocket to ${args.url} failed`))
      })
      socket.addEventListener('close', (event) => {
        if (!opened) {
          handlers.signal.removeEventListener('abort', handleAbort)
          reject(new Error(`websocket to ${args.url} closed before opening: ${event.code}`))
          return
        }
        handlers.onClose(event.code, event.reason)
      })
    })
