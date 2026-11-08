import type { PodControlClient } from '@dltech/atlas-host'

const TIMEOUT_MS = 15_000

type TrpcError = { message?: string; json?: { message?: string } }

type TrpcEnvelope = { result?: { data?: unknown }; error?: TrpcError }

type ExposePortReply = { url: string; tunnelToken: string }

const parseJson = (raw: string, status: number): TrpcEnvelope => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object')
    }
    return parsed as TrpcEnvelope
  } catch {
    throw new Error(`the control plane answered ${status} without a JSON body`)
  }
}

const errorMessageOf = (envelope: TrpcEnvelope): string | undefined =>
  envelope.error?.json?.message ?? envelope.error?.message

const isReply = (value: unknown): value is ExposePortReply =>
  typeof value === 'object' &&
  value !== null &&
  'url' in value &&
  typeof value.url === 'string' &&
  'tunnelToken' in value &&
  typeof value.tunnelToken === 'string'

export const podControlClientOf = (args: {
  apiOrigin: string
  token: string
}): PodControlClient => ({
  exposePort: async ({ threadId, port, signal }) => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const response = await fetch(`${args.apiOrigin}/v1/trpc/hostSelf.exposePort`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({ threadId, port }),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    const envelope = parseJson(await response.text(), response.status)
    const message = errorMessageOf(envelope)
    if (!response.ok) {
      throw new Error(`the control plane rejected the call (${response.status}): ${message}`)
    }
    if (message !== undefined) throw new Error(message)
    if (!isReply(envelope.result?.data)) {
      throw new Error('the control plane answered without a url and a tunnel token')
    }
    return envelope.result.data
  },
})
