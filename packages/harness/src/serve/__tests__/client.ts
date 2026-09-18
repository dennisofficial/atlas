import {
  CHANNEL_SUBPROTOCOL,
  bearerSubprotocolOf,
  decodeServeFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../../cloud/channel-wire'

const PATIENCE_MS = 2_000

export type TestClient = {
  frames: readonly ServeFrame[]
  send: (frame: ClientFrame) => void
  waitFor: (predicate: (frame: ServeFrame) => boolean) => Promise<ServeFrame>
  closed: Promise<number>
  close: () => void
}

const impatient = <T>(args: { promise: Promise<T>; what: string }): Promise<T> =>
  Promise.race([
    args.promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`waited too long for ${args.what}`)), PATIENCE_MS),
    ),
  ])

export async function connect(args: { port: number; token: string }): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${args.port}/v1/session`, [
    CHANNEL_SUBPROTOCOL,
    bearerSubprotocolOf(args.token),
  ])

  const frames: ServeFrame[] = []
  const waiters: { predicate: (frame: ServeFrame) => boolean; settle: (frame: ServeFrame) => void }[] =
    []

  let onClosed = (code: number): void => void code
  const closed = new Promise<number>((resolve) => {
    onClosed = resolve
  })

  socket.addEventListener('message', (event: MessageEvent) => {
    const frame = decodeServeFrame(String(event.data))
    if (frame === null) return

    frames.push(frame)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(frame)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.settle(frame)
    }
  })

  socket.addEventListener('close', (event: CloseEvent) => onClosed(event.code))

  await impatient({
    what: 'the socket to open',
    promise: new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve())
      socket.addEventListener('close', () => reject(new Error('the upgrade was refused')))
      socket.addEventListener('error', () => reject(new Error('the upgrade was refused')))
    }),
  })

  return {
    frames,

    send: (frame) => socket.send(encodeFrame(frame)),

    waitFor: (predicate) => {
      const held = frames.find(predicate)
      if (held !== undefined) return Promise.resolve(held)

      return impatient({
        what: 'a matching frame',
        promise: new Promise<ServeFrame>((resolve) => waiters.push({ predicate, settle: resolve })),
      })
    },

    closed,

    close: () => socket.close(),
  }
}
