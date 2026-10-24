import { createApiClient, detailsOf, httpStatusOf } from '@dltech/atlas-api-router'

import { UNREACHABLE } from './auth-api'
import { CloudApiError } from './cloud-api'

export const api = createApiClient({ baseUrl: '' })

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const detailMessageOf = (details: Record<string, unknown> | undefined): string | undefined => {
  const message = details?.message
  if (Array.isArray(message)) return stringOf(message[0])
  return stringOf(message)
}

const toCloudApiError = (failure: unknown): CloudApiError => {
  if (failure instanceof CloudApiError) return failure
  const status = httpStatusOf(failure)
  if (status === undefined) return new CloudApiError({ message: UNREACHABLE, status: 0 })
  const details = detailsOf(failure)
  const errorMessage = failure instanceof Error ? stringOf(failure.message) : undefined
  return new CloudApiError({
    message: detailMessageOf(details) ?? errorMessage ?? `Atlas Cloud answered ${status}`,
    status,
    code: stringOf(details?.code),
  })
}

export async function cloudCall<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (failure) {
    throw toCloudApiError(failure)
  }
}
