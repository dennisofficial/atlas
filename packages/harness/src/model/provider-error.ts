import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from './errors'

export type ProviderErrorIdentity = {
  providerCode?: string | number
  providerType?: string
}

const MAX_BODY_CHARS = 16_384
const MAX_IDENTIFIER_CHARS = 80
const IDENTIFIER = /^[a-zA-Z0-9_.:-]+$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const identifierOf = (value: unknown): string | number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  if (value.length > MAX_IDENTIFIER_CHARS) return undefined
  return IDENTIFIER.test(value) ? value : undefined
}

const identityOfPayload = (payload: unknown): ProviderErrorIdentity => {
  if (!isRecord(payload)) return {}
  const nested = payload.error
  if (!isRecord(nested)) return {}

  const providerCode = identifierOf(nested.code)
  const providerType = identifierOf(nested.type)
  return {
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(typeof providerType === 'string' ? { providerType } : {}),
  }
}

const parseBody = (body: string | undefined): unknown => {
  if (body === undefined || body.length > MAX_BODY_CHARS) return undefined
  return JSON.parse(body)
}

const readSafely = (read: () => ProviderErrorIdentity): ProviderErrorIdentity => {
  try {
    return read()
  } catch {
    return {}
  }
}

export function providerErrorOf(error: unknown): ProviderErrorIdentity {
  if (error instanceof ModelStreamError) return providerErrorOf(error.cause)

  if (StreamProviderError.isInstance(error)) {
    return readSafely(() => identityOfPayload(error.data))
  }

  if (APICallError.isInstance(error)) {
    const fromData = readSafely(() => identityOfPayload(error.data))
    if (fromData.providerCode !== undefined && fromData.providerType !== undefined) return fromData
    const fromBody = readSafely(() => identityOfPayload(parseBody(error.responseBody)))
    return { ...fromBody, ...fromData }
  }

  return {}
}
