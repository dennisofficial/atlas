import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'

import {
  EAuthKind,
  toAccountId,
  type Credential,
  type CredentialPort,
  type CredentialRequest,
} from '@dltech/atlas-core'

export type CapturedRequest = { url: string; headers: Record<string, string>; body: unknown }

export const apiKey = (key: string): Credential => ({
  kind: EAuthKind.ApiKey,
  accountId: toAccountId('acct-1'),
  apiKey: key,
})

export class FakeCredentials implements CredentialPort {
  readonly reads: (CredentialRequest | undefined)[] = []
  readonly discarded: Credential[] = []

  constructor(private readonly queue: Credential[]) {}

  async read(request?: CredentialRequest): Promise<Credential> {
    this.reads.push(request)
    const next = this.queue.length > 1 ? this.queue.shift() : this.queue[0]
    if (next === undefined) throw new Error('no credential queued')
    return next
  }

  async discard(credential: Credential): Promise<void> {
    this.discarded.push(credential)
  }
}

export const sse = (events: readonly unknown[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

export type FakeReply = { status?: number; body: string; contentType?: string }

export function fakeFetch(replies: readonly FakeReply[]) {
  const requests: CapturedRequest[] = []
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const raw = typeof init?.body === 'string' ? init.body : undefined
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers,
      body: raw === undefined ? undefined : JSON.parse(raw),
    })
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)]
    if (reply === undefined) throw new Error('no reply queued')
    return new Response(reply.body, {
      status: reply.status ?? 200,
      headers: { 'content-type': reply.contentType ?? 'text/event-stream' },
    })
  }
  return { requests, fetch: handler as typeof fetch }
}

export const CALL_OPTIONS: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello there' }] }],
}

export async function drain(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const parts: LanguageModelV4StreamPart[] = []
  for (const reader = stream.getReader(); ; ) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

export const textOf = (parts: readonly LanguageModelV4StreamPart[]): string =>
  parts.flatMap((part) => (part.type === 'text-delta' ? [part.delta] : [])).join('')
