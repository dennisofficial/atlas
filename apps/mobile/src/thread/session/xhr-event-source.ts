import { createParser, type EventSourceParser } from 'eventsource-parser'
import { fetch } from 'expo/fetch'

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

const DEFAULT_RETRY_MS = 3000
const JSON_RPC_SERVER_ERROR = -32000
const MAX_FRAME_CHARS = 4 * 1024 * 1024
const DECODE_CHUNK_BYTES = 16 * 1024

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
  private request: AbortController | undefined
  private reopenTimer: ReturnType<typeof setTimeout> | undefined
  private retryMs = DEFAULT_RETRY_MS
  private lastEventId = ''
  private decoder = new TextDecoder()
  private frameChars = 0
  private trailingLf = false
  private skipLf = false

  constructor(url: string | URL, init?: XhrEventSourceInit) {
    this.url = String(url)
    this.headers = init?.headers ?? {}
    this.withCredentials = init?.credentials === 'include'
    this.parser = createParser({
      onEvent: (message) => {
        if (this.readyState !== EReadyState.Open) return
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
    this.parser.reset()
  }

  private open(): void {
    const request = new AbortController()
    this.request = request
    this.decoder = new TextDecoder()
    this.frameChars = 0
    this.trailingLf = false
    this.skipLf = false
    this.parser.reset()
    void this.read(request)
  }

  private async read(request: AbortController): Promise<void> {
    const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-store', ...this.headers }
    if (this.lastEventId !== '') Object.assign(headers, { 'Last-Event-ID': this.lastEventId })
    try {
      const response = await fetch(this.url, {
        headers,
        credentials: this.withCredentials ? 'include' : 'omit',
        signal: request.signal,
      })
      if (request !== this.request) {
        await response.body?.cancel()
        return
      }
      if (response.status !== 200) {
        this.fail(response.status)
        return
      }
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error('the stream has no body')
      try {
        this.readyState = EReadyState.Open
        this.emit({ type: 'open' })
        while (request === this.request) {
          const { done, value } = await reader.read()
          if (request !== this.request || done) break
          this.feed(value)
        }
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
      this.handleDrop(request)
    } catch {
      this.handleDrop(request)
    }
  }

  private feed(bytes: Uint8Array): void {
    for (
      let offset = 0;
      offset < bytes.length && this.readyState === EReadyState.Open;
      offset += DECODE_CHUNK_BYTES
    ) {
      const chunk = bytes.subarray(offset, offset + DECODE_CHUNK_BYTES)
      const text = this.decoder.decode(chunk, { stream: true })
      this.checkFrame(text)
      this.parser.feed(text)
    }
  }

  private checkFrame(text: string): void {
    if (text === '') return
    const fresh = this.skipLf && text.startsWith('\n') ? text.slice(1) : text
    this.skipLf = text.endsWith('\r')
    const normalized = (this.trailingLf ? '\n' : '') + fresh.replace(/\r\n?/g, '\n')
    const buffered = this.frameChars - (this.trailingLf ? 1 : 0)
    const firstBoundary = normalized.indexOf('\n\n')
    if (firstBoundary === -1) {
      this.frameChars = buffered + normalized.length
    } else {
      if (buffered + firstBoundary + 2 > MAX_FRAME_CHARS)
        throw new Error('the stream frame is too large')
      this.frameChars = normalized.length - normalized.lastIndexOf('\n\n') - 2
    }
    if (this.frameChars > MAX_FRAME_CHARS) throw new Error('the stream frame is too large')
    this.trailingLf = this.frameChars > 0 && normalized.endsWith('\n')
  }

  private handleDrop(request: AbortController): void {
    if (request !== this.request) return
    this.request = undefined
    request.abort()
    this.parser.reset()
    this.readyState = EReadyState.Connecting
    this.emit({ type: 'error' })
    if (this.readyState !== EReadyState.Connecting) return
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = undefined
      if (this.readyState === EReadyState.Connecting) this.open()
    }, this.retryMs)
  }

  private fail(status: number): void {
    this.close()
    this.emit({ type: 'error', error: refusalOf(status) })
  }

  private emit(event: XhrSourceEvent): void {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event)
  }
}
