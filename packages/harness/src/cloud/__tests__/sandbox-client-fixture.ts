import { SandboxClient } from '../sandbox-client'

export type Call = {
  url: string
  method: string
  headers: Headers
  body?: unknown
  input?: unknown
}

export type Reply = { status?: number; data?: unknown; message?: string }

const reply = (entry: Reply | undefined): Response => {
  if (entry?.status !== undefined && entry.status >= 400) {
    return Response.json(
      {
        error: {
          message: entry.message ?? 'failed',
          code: -32603,
          data: { code: 'ERROR', httpStatus: entry.status },
        },
      },
      { status: entry.status },
    )
  }
  return Response.json({ result: { data: entry?.data ?? null } })
}

export const harness = (replies: readonly Reply[]) => {
  const calls: Call[] = []
  let at = 0

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    const encoded = url.searchParams.get('input')
    calls.push({
      url: `${url.origin}${url.pathname}`,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
      ...(encoded === null ? {} : { input: JSON.parse(encoded) }),
    })
    const entry = replies[at]
    at += 1
    return reply(entry)
  }) as typeof fetch

  const client = new SandboxClient({
    url: 'https://cloud.test/',
    token: 'sess_test',
    clientVersion: '1.2.3',
    fetchFn,
  })
  return { client, calls }
}

export const CLAIM_URL = 'https://cloud.test/v1/trpc/sandboxes.claim'
