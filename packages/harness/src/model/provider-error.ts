import { APICallError } from '@ai-sdk/provider'
import { StreamProviderError } from 'ai'

import { ModelStreamError } from './errors'

export type ProviderErrorIdentity = {
  providerCode?: string | number
  providerType?: string
}

const MAX_BODY_CHARS = 16_384
const MAX_PROVIDER_TEXT_CHARS = 2_048
const MAX_IDENTIFIER_CHARS = 80
const IDENTIFIER = /^[a-zA-Z0-9_.:-]+$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

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
    const fromData = readSafely(() => identityOfPayload(error.data))
    const providerCode = fromData.providerCode ?? identifierOf(error.code)
    const providerType = fromData.providerType ?? identifierOf(error.type)
    return {
      ...(providerCode === undefined ? {} : { providerCode }),
      ...(typeof providerType === 'string' ? { providerType } : {}),
    }
  }

  if (APICallError.isInstance(error)) {
    const fromData = readSafely(() => identityOfPayload(error.data))
    if (fromData.providerCode !== undefined && fromData.providerType !== undefined) return fromData
    const fromBody = readSafely(() => identityOfPayload(parseBody(error.responseBody)))
    return { ...fromBody, ...fromData }
  }

  return {}
}

const messageOfPayload = (payload: unknown): string | undefined => {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  const { message } = payload.error
  return typeof message === 'string' && message.trim() !== '' ? message : undefined
}

const readMessage = (read: () => string | undefined): string | undefined => {
  try {
    return read()
  } catch {
    return undefined
  }
}

const boundedText = (text: string): string => text.slice(0, MAX_PROVIDER_TEXT_CHARS)

export function providerMessageOf(error: unknown): string | undefined {
  if (error instanceof ModelStreamError) return providerMessageOf(error.cause)

  if (StreamProviderError.isInstance(error)) {
    const found = readMessage(() => messageOfPayload(error.data))
    return boundedText(found ?? error.message)
  }

  if (APICallError.isInstance(error)) {
    const found =
      readMessage(() => messageOfPayload(error.data)) ??
      readMessage(() => messageOfPayload(parseBody(error.responseBody)))
    return boundedText(found ?? error.message)
  }

  return undefined
}
