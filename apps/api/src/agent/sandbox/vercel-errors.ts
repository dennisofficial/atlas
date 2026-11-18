import { APIError } from '@vercel/sandbox'

const snapshotCodeOf = (json: unknown): string | undefined => {
  if (typeof json !== 'object' || json === null) return undefined
  const error = (json as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

const vercelMessageOf = (error: APIError<unknown>): string => {
  if (typeof error.json === 'object' && error.json !== null) {
    const errorField = (error.json as { error?: unknown }).error
    if (typeof errorField === 'object' && errorField !== null) {
      const message = (errorField as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return error.message
}

export const failureTextOf = (failure: unknown): string => {
  if (failure instanceof APIError) return vercelMessageOf(failure)
  if (failure instanceof Error) return failure.message
  return String(failure)
}

const SANDBOX_NOT_FOUND_FOR_PROJECT = /sandbox\s+'[^']*'\s+not found for this project/i

const IMAGE_NOT_FOUND = /^image not found/i

export const isImageNotFound = (failure: unknown): boolean => {
  if (!(failure instanceof APIError) || failure.response.status !== 404) return false
  return IMAGE_NOT_FOUND.test(failureTextOf(failure))
}

export const isSandboxMissing = (error: unknown): boolean => {
  if (error instanceof APIError) {
    if (error.response.status === 404) return !isImageNotFound(error)
    if (error.response.status === 410 && snapshotCodeOf(error.json) === 'snapshot_not_found') {
      return true
    }
  }
  return SANDBOX_NOT_FOUND_FOR_PROJECT.test(failureTextOf(error))
}

const isImageNotReady = (failure: unknown): boolean => {
  if (!(failure instanceof APIError)) return false
  return failure.response.status === 409 && snapshotCodeOf(failure.json) === 'image_not_ready'
}

export const isImageOptimizeLag = (failure: unknown): boolean =>
  isImageNotReady(failure) && !failureTextOf(failure).includes('optimization failed')

export const isImageOptimizeFailure = (failure: unknown): boolean =>
  isImageNotReady(failure) && failureTextOf(failure).includes('optimization failed')

export class VercelFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VercelFailure'
  }
}

const SANDBOX_NAME_TAKEN = /a sandbox with the name\s+'[^']*'\s+already exists for this project/i

export const isSandboxNameConflict = (failure: unknown): boolean => {
  if (failure instanceof APIError && failure.response.status !== 400) return false
  return SANDBOX_NAME_TAKEN.test(failureTextOf(failure))
}
