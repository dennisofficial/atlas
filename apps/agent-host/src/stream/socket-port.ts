import type { RawData, WebSocket } from 'ws'

export type StreamSocketPort = {
  send(payload: string): void
  close(code: number): void
  bufferedAmount(): number
}

export const streamSocketPort = (socket: WebSocket): StreamSocketPort => ({
  send: (payload) => socket.send(payload),
  close: (code) => socket.close(code),
  bufferedAmount: () => socket.bufferedAmount,
})

export const onSocketDrain = (socket: WebSocket, handler: () => void): void => {
  const upstream: { on?: (event: string, listener: () => void) => void } | undefined = Reflect.get(
    socket,
    '_socket',
  )
  upstream?.on?.('drain', handler)
}

export const frameText = (raw: RawData): string => {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return raw.toString('utf8')
}
