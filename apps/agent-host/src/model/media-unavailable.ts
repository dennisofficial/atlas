import { ModelStreamError } from '@dltech/atlas-agent'
import { DownloadError } from 'ai'

import { providerMessageOf } from './provider-error'

const PROVIDER_DOWNLOAD_REFUSAL = /unable to download the file|error while downloading file/i

const rootCauseOf = (error: unknown): unknown =>
  error instanceof ModelStreamError && error.cause !== undefined ? rootCauseOf(error.cause) : error

export function isMediaUnavailable(error: unknown): boolean {
  if (DownloadError.isInstance(rootCauseOf(error))) return true
  const message = providerMessageOf(error)
  return message !== undefined && PROVIDER_DOWNLOAD_REFUSAL.test(message)
}
