import { parseServerMessage, type StreamServerMessage } from '@dltech/atlas-protocol'

const WAIT_MS = 2_000

export const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), WAIT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })

export const until = async (condition: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + WAIT_MS
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(2)
  }
}

export class TestClient {
  readonly closed: Promise<number>
  private readonly socket: WebSocket
  private readonly unread: StreamServerMessage[] = []
  private waiting: ((message: StreamServerMessage) => void) | undefined
  private closeCode: number | undefined
  private readonly opened: Promise<void>

  constructor(args: { url: string; headers?: Record<string, string> }) {
    this.socket = new WebSocket(
      args.url,
      args.headers === undefined ? {} : { headers: args.headers },
    )
    this.opened = new Promise<void>((resolve) => {
      this.socket.addEventListener('open', () => resolve())
    })
    this.closed = new Promise<number>((resolve) => {
      this.socket.addEventListener('close', (event) => {
        this.closeCode = event.code
        resolve(event.code)
      })
    })
    this.socket.addEventListener('message', (event) => {
      const parsed = parseServerMessage(JSON.parse(String(event.data)))
      if (!parsed.ok) throw new Error('server sent a frame outside the protocol')
      const waiter = this.waiting
      this.waiting = undefined
      if (waiter === undefined) this.unread.push(parsed.message)
      else waiter(parsed.message)
    })
  }

  get isClosed(): boolean {
    return this.closeCode !== undefined
  }

  send(value: unknown): void {
    const frame = typeof value === 'string' ? value : JSON.stringify(value)
    this.opened.then(() => {
      if (!this.isClosed) this.socket.send(frame)
    })
  }

  next(): Promise<StreamServerMessage> {
    const queued = this.unread.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    const arrival = new Promise<StreamServerMessage>((resolve) => {
      this.waiting = resolve
    })
    return withTimeout(arrival, 'the next frame')
  }

  waitClosed(): Promise<number> {
    return withTimeout(this.closed, 'the socket to close')
  }

  close(): void {
    if (!this.isClosed) this.socket.close()
  }
}
