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
