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

// Vercel also reports a sandbox gone as "Sandbox '<name>' not found for this project." with a
// non-404 status (observed when a by-name call lands mid-deletion, October 2026), which neither the
// 404 check nor the SDK's own getOrCreate not-found branch recognizes. The text carries the missing
// there; scoping the match to sandbox avoids swallowing a same-phrased drive failure.
const SANDBOX_NOT_FOUND_FOR_PROJECT = /sandbox\s+'[^']*'\s+not found for this project/i

export const isSandboxMissing = (error: unknown): boolean => {
  if (error instanceof APIError) {
    // A 404 on a create whose payload names the image is the image missing, not the sandbox —
    // the retry-settle branch would otherwise blame the sandbox for an unpublished image.
    if (error.response.status === 404) return !isImageNotFound(error)
    if (error.response.status === 410 && snapshotCodeOf(error.json) === 'snapshot_not_found') {
      return true
    }
  }
  return SANDBOX_NOT_FOUND_FOR_PROJECT.test(failureTextOf(error))
}

const IMAGE_NOT_FOUND = /^image not found/i

export const isImageNotFound = (failure: unknown): boolean => {
  if (!(failure instanceof APIError) || failure.response.status !== 404) return false
  return IMAGE_NOT_FOUND.test(failureTextOf(failure))
}

const isImageNotReady = (failure: unknown): boolean => {
  if (!(failure instanceof APIError)) return false
  return failure.response.status === 409 && snapshotCodeOf(failure.json) === 'image_not_ready'
}

/**
 * Vercel answers a sandbox create with 409 `image_not_ready` in two flavors that share the code
 * and differ only in the message: "not ready" while the image is still optimizing (worth
 * retrying, observed end-to-end in about two minutes) and "optimization failed", which Vercel
 * caches against the image's digest and never retried on its own in October 2026 probes.
 */
export const isImageOptimizeLag = (failure: unknown): boolean =>
  isImageNotReady(failure) && !failureTextOf(failure).includes('optimization failed')

export const isImageOptimizeFailure = (failure: unknown): boolean =>
  isImageNotReady(failure) && failureTextOf(failure).includes('optimization failed')

export const asVercelFailure = (failure: unknown): Error => {
  if (failure instanceof APIError) return new Error(vercelMessageOf(failure))
  if (failure instanceof Error) return failure
  return new Error('the sandbox provider failed unexpectedly')
}

export enum EVercelFailure {
  Unknown = 'unknown',
  DriveAttached = 'drive-attached',
  NameConflict = 'name-conflict',
  ImageOptimize = 'image-optimize',
  ImageNotFound = 'image-not-found',
  DrainRefused = 'drain-refused',
}

export class VercelFailure extends Error {
  constructor(args: { kind: EVercelFailure; message: string }) {
    super(args.message)
    this.name = 'VercelFailure'
    this.kind = args.kind
  }

  readonly kind: EVercelFailure
}

// Vercel answers a create whose name is already taken with a generic 400 `bad_request` — the
// code is shared with any malformed request (probed October 2026), so only the message
// discriminates. That message is the wake's settle race: the resume probe found the name free
// (or deleted the stale sandbox itself), and the name registry has not caught up. A next attempt
// either finds the sandbox through the GET or succeeds through the POST, so the conflict is
// always worth the settle retry, never a hard failure on first sight.
const SANDBOX_NAME_TAKEN = /a sandbox with the name\s+'[^']*'\s+already exists for this project/i

export const isSandboxNameConflict = (failure: unknown): boolean => {
  if (failure instanceof APIError) {
    if (failure.response.status !== 400) return false
    return SANDBOX_NAME_TAKEN.test(failureTextOf(failure))
  }
  return SANDBOX_NAME_TAKEN.test(failureTextOf(failure))
}

export const isDriveAttachedConflict = (failure: unknown): boolean => {
  const text = failureTextOf(failure)
  return text.includes('already attached') || text.includes('currently attached')
}

/**
 * The delete side of the attach conflict. Vercel answers a drive delete that races the detach
 * with a bare 409 whose payload shape is not documented, so the status classifies where the
 * message text cannot. Delete is the only drive operation the lifecycle performs, so a 409 there
 * is always the attach conflict.
 */
export const isDriveDeleteConflict = (failure: unknown): boolean => {
  if (failure instanceof APIError && failure.response.status === 409) return true
  return failureTextOf(failure).includes('currently attached')
}
