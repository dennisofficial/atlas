const SESSION_PATH = '/v1/session'

export type ChannelSocketHandlers = {
  handleOpen(): void
  handleMessage(data: string): void
  handlePing(): void
  handleClose(): void
  handleError(message: string): void
}

export type ChannelSocket = {
  send(data: string): void
  close(): void
  isOpen?: (() => boolean) | undefined
}

export type ChannelSocketFactory = (args: {
  url: string
  protocols: readonly string[]
  handlers: ChannelSocketHandlers
}) => ChannelSocket

export const sessionSocketUrlOf = (url: string): string =>
  `${url.replace(/\/+$/, '').replace(/^http/, 'ws')}${SESSION_PATH}`

export const webSocketFactory: ChannelSocketFactory = ({ url, protocols, handlers }) => {
  const socket = new WebSocket(url, [...protocols])
  socket.onopen = () => handlers.handleOpen()
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.handleMessage(event.data)
  }
  socket.onclose = () => handlers.handleClose()
  socket.onerror = () => handlers.handleError('The session socket reported an error.')

  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    isOpen: () => socket.readyState === WebSocket.OPEN,
  }
}
