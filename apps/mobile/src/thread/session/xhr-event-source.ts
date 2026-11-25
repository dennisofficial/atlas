import { createParser, type EventSourceParser } from 'eventsource-parser'

export enum EReadyState {
  Connecting = 0,
  Open = 1,
  Closed = 2,
}

type RefusalBody = { message: string; code: number; data: { httpStatus: number } }

export type XhrSourceEvent = {
  type: string
  data?: string | undefined
  lastEventId?: string | undefined
  error?: RefusalBody | undefined
}

export type XhrEventSourceInit = {
  headers?: Record<string, string> | undefined
  credentials?: string | undefined
}

type Listener = (event: XhrSourceEvent) => void

const HEADERS_RECEIVED = 2
const DONE = 4
const DEFAULT_RETRY_MS = 3000
const JSON_RPC_SERVER_ERROR = -32000

const refusalOf = (status: number): RefusalBody => ({
  message: `the stream answered ${status}`,
  code: JSON_RPC_SERVER_ERROR,
  data: { httpStatus: status },
})

export class XhrEventSource {
  readonly CONNECTING = EReadyState.Connecting
  readonly OPEN = EReadyState.Open
  readonly CLOSED = EReadyState.Closed
  readyState: EReadyState = EReadyState.Connecting
  readonly url: string
  private readonly headers: Record<string, string>
  private readonly withCredentials: boolean
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly parser: EventSourceParser
  private request: XMLHttpRequest | undefined
  private reopenTimer: ReturnType<typeof setTimeout> | undefined
  private retryMs = DEFAULT_RETRY_MS
  private lastEventId = ''
  private consumed = 0

  constructor(url: string | URL, init?: XhrEventSourceInit) {
    this.url = String(url)
    this.headers = init?.headers ?? {}
    this.withCredentials = init?.credentials === 'include'
    this.parser = createParser({
      onEvent: (message) => {
        if (message.id !== undefined) this.lastEventId = message.id
        this.emit({
          type: message.event ?? 'message',
          data: message.data,
          lastEventId: this.lastEventId,
        })
      },
      onRetry: (ms) => {
        this.retryMs = ms
      },
    })
    this.open()
  }

  addEventListener(type: string, listener: Listener): void {
    const held = this.listeners.get(type) ?? new Set<Listener>()
    held.add(listener)
    this.listeners.set(type, held)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.readyState = EReadyState.Closed
    if (this.reopenTimer !== undefined) clearTimeout(this.reopenTimer)
    this.reopenTimer = undefined
    const request = this.request
    this.request = undefined
    request?.abort()
  }

  private open(): void {
    const request = new XMLHttpRequest()
    this.request = request
    this.consumed = 0
    this.parser.reset()
    request.open('GET', this.url, true)
    request.withCredentials = this.withCredentials
    request.setRequestHeader('Accept', 'text/event-stream')
    request.setRequestHeader('Cache-Control', 'no-store')
    for (const [name, value] of Object.entries(this.headers)) request.setRequestHeader(name, value)
    if (this.lastEventId !== '') request.setRequestHeader('Last-Event-ID', this.lastEventId)
    request.onreadystatechange = () => this.handleProgress(request)
    request.onerror = () => this.handleDrop(request)
    request.send()
  }

  private handleProgress(request: XMLHttpRequest): void {
    if (request !== this.request || request.readyState < HEADERS_RECEIVED) return
    if (request.status === 0) return
    if (request.status !== 200) {
      this.fail(request.status)
      return
    }
    if (this.readyState === EReadyState.Connecting) {
      this.readyState = EReadyState.Open
      this.emit({ type: 'open' })
    }
    const text = request.responseText
    if (text.length > this.consumed) {
      const fresh = text.slice(this.consumed)
      this.consumed = text.length
      this.parser.feed(fresh)
    }
    if (request.readyState === DONE) this.handleDrop(request)
  }

  private handleDrop(request: XMLHttpRequest): void {
    if (request !== this.request) return
    this.request = undefined
    this.readyState = EReadyState.Connecting
    this.emit({ type: 'error' })
    if (this.readyState !== EReadyState.Connecting) return
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = undefined
      if (this.readyState === EReadyState.Connecting) this.open()
    }, this.retryMs)
  }

  private fail(status: number): void {
    const request = this.request
    this.request = undefined
    this.readyState = EReadyState.Closed
    request?.abort()
    this.emit({ type: 'error', error: refusalOf(status) })
  }

  private emit(event: XhrSourceEvent): void {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event)
  }
}
