import { APIError } from '@vercel/sandbox'

export class SandboxMissingError extends Error {
  constructor(sandboxName?: string) {
    super(
      sandboxName === undefined
        ? 'sandbox no longer exists on Vercel'
        : `sandbox ${sandboxName} no longer exists on Vercel`,
    )
    this.name = 'SandboxMissingError'
  }
}

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

export const isSandboxMissing = (error: unknown): boolean => {
  if (!(error instanceof APIError)) return false
  if (error.response.status === 404) return true
  return error.response.status === 410 && snapshotCodeOf(error.json) === 'snapshot_not_found'
}

export const asVercelFailure = (failure: unknown): Error => {
  if (failure instanceof APIError) return new Error(vercelMessageOf(failure))
  if (failure instanceof Error) return failure
  return new Error('the sandbox provider failed unexpectedly')
}

export enum EVercelFailure {
  Unknown = 'unknown',
  DriveAttached = 'drive-attached',
}

export class VercelFailure extends Error {
  constructor(args: { kind: EVercelFailure; message: string }) {
    super(args.message)
    this.name = 'VercelFailure'
    this.kind = args.kind
  }

  readonly kind: EVercelFailure
}

export const isDriveAttachedConflict = (failure: unknown): boolean => {
  const text = failureTextOf(failure)
  return text.includes('already attached') || text.includes('currently attached')
}
