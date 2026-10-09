import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import {
  isDriveAttachedConflict,
  isDriveDeleteConflict,
  isImageNotFound,
  isImageOptimizeFailure,
  isImageOptimizeLag,
  isSandboxMissing,
  isSandboxNameConflict,
} from '../sandbox-errors.js'

describe('isDriveAttachedConflict', () => {
  it('classifies the create-side conflict', () => {
    const failure = new Error(
      'Drive `atlas-drive-abc` is already attached as read-write to sandbox atlas-thread-abc',
    )

    expect(isDriveAttachedConflict(failure)).toBe(true)
  })

  it('classifies the delete-side conflict', () => {
    const failure = new Error('Cannot delete a drive that is currently attached to a sandbox.')

    expect(isDriveAttachedConflict(failure)).toBe(true)
  })

  it('reads the message out of a Vercel API error payload', () => {
    const failure = new APIError(new Response(null, { status: 409 }), {
      message: 'conflict',
      json: {
        error: {
          message:
            'Drive `atlas-drive-abc` is already attached as read-write to sandbox atlas-thread-abc',
        },
      },
    })

    expect(isDriveAttachedConflict(failure)).toBe(true)
  })

  it('passes over an unrelated failure', () => {
    expect(isDriveAttachedConflict(new Error('the drive is full'))).toBe(false)
    expect(isDriveAttachedConflict('a string failure')).toBe(false)
  })
})

describe('isDriveDeleteConflict', () => {
  it('classifies a 409 whose payload carries no recognizable message', () => {
    const failure = new APIError(new Response(null, { status: 409 }), {
      message: 'Conflict',
      json: { error: { code: 'drive_conflict' } },
    })

    expect(isDriveDeleteConflict(failure)).toBe(true)
  })

  it('classifies the delete-side conflict by message for non-API failures', () => {
    const failure = new Error('Cannot delete a drive that is currently attached to a sandbox.')

    expect(isDriveDeleteConflict(failure)).toBe(true)
  })

  it('passes over other statuses and unrelated failures', () => {
    const serverError = new APIError(new Response(null, { status: 500 }), {
      message: 'Internal Server Error',
      json: { error: { message: 'something else broke' } },
    })

    expect(isDriveDeleteConflict(serverError)).toBe(false)
    expect(isDriveDeleteConflict(new Error('the drive is full'))).toBe(false)
  })
})

describe('isSandboxMissing', () => {
  it('classifies a plain 404', () => {
    const failure = new APIError(new Response(null, { status: 404 }), {
      message: 'sandbox not found',
    })

    expect(isSandboxMissing(failure)).toBe(true)
  })

  it('classifies a 410 whose snapshot is gone', () => {
    const failure = new APIError(new Response(null, { status: 410 }), {
      json: { error: { code: 'snapshot_not_found' } },
    })

    expect(isSandboxMissing(failure)).toBe(true)
  })

  it('classifies Vercel’s project-scoped not-found however it is reported', () => {
    const apiFailure = new APIError(new Response(null, { status: 400 }), {
      json: { error: { message: "Sandbox 'atlas-thread-x' not found for this project." } },
    })

    expect(isSandboxMissing(apiFailure)).toBe(true)
    expect(
      isSandboxMissing(new Error("Sandbox 'atlas-thread-x' not found for this project.")),
    ).toBe(true)
  })

  it('leaves an image not found to its own classification', () => {
    const failure = new APIError(new Response(null, { status: 404 }), {
      json: { error: { message: 'Image not found.' } },
    })

    expect(isSandboxMissing(failure)).toBe(false)
  })

  it('passes over unrelated failures and a drive carrying the same phrasing', () => {
    const serverError = new APIError(new Response(null, { status: 500 }), {
      json: { error: { message: 'something else broke' } },
    })
    const driveFailure = new APIError(new Response(null, { status: 400 }), {
      json: { error: { message: "Drive 'atlas-drive-x' not found for this project." } },
    })

    expect(isSandboxMissing(serverError)).toBe(false)
    expect(isSandboxMissing(driveFailure)).toBe(false)
    expect(isSandboxMissing(new Error('the quota is exhausted'))).toBe(false)
  })
})

describe('isSandboxNameConflict', () => {
  it('classifies the 400 bad_request the name registry answers a taken name with', () => {
    const failure = new APIError(new Response(null, { status: 400 }), {
      json: {
        error: {
          code: 'bad_request',
          message:
            "A sandbox with the name 'atlas-thread-x' already exists for this project. Use GET /sandboxes/:name to resume it or delete it first.",
        },
      },
    })

    expect(isSandboxNameConflict(failure)).toBe(true)
  })

  it('classifies the same message off a plain error', () => {
    const failure = new Error(
      "A sandbox with the name 'atlas-thread-x' already exists for this project. Use GET /sandboxes/:name to resume it or delete it first.",
    )

    expect(isSandboxNameConflict(failure)).toBe(true)
  })

  it('passes over another 400, another status, and a drive carrying the same phrasing', () => {
    const badRequest = new APIError(new Response(null, { status: 400 }), {
      json: { error: { code: 'bad_request', message: 'The `timeout` field must be a number.' } },
    })
    const wrongStatus = new APIError(new Response(null, { status: 409 }), {
      json: {
        error: {
          message: "A sandbox with the name 'atlas-thread-x' already exists for this project.",
        },
      },
    })
    const driveFailure = new APIError(new Response(null, { status: 400 }), {
      json: {
        error: { message: "A drive with the name 'atlas-drive-x' already exists for this project." },
      },
    })

    expect(isSandboxNameConflict(badRequest)).toBe(false)
    expect(isSandboxNameConflict(wrongStatus)).toBe(false)
    expect(isSandboxNameConflict(driveFailure)).toBe(false)
    expect(isSandboxNameConflict(new Error('the quota is exhausted'))).toBe(false)
  })
})

describe('isImageNotFound', () => {
  it('classifies the create-side 404 the sandbox image carries', () => {
    const failure = new APIError(new Response(null, { status: 404 }), {
      json: { error: { message: 'Image not found.' } },
    })

    expect(isImageNotFound(failure)).toBe(true)
  })

  it('passes over a missing sandbox and unrelated failures', () => {
    const sandboxMissing = new APIError(new Response(null, { status: 404 }), {
      json: { error: { message: "Sandbox 'atlas-thread-x' not found for this project." } },
    })
    const serverError = new APIError(new Response(null, { status: 500 }), {
      json: { error: { message: 'Image not found.' } },
    })

    expect(isImageNotFound(sandboxMissing)).toBe(false)
    expect(isImageNotFound(serverError)).toBe(false)
    expect(isImageNotFound(new Error('the quota is exhausted'))).toBe(false)
  })
})

describe('image not ready classification', () => {
  const imageNotReady = (message: string): APIError<unknown> =>
    new APIError(new Response(null, { status: 409 }), {
      json: { error: { code: 'image_not_ready', message } },
    })

  it('reads still-optimizing as a lag worth retrying, optimization-failed as terminal', () => {
    expect(isImageOptimizeLag(imageNotReady('Image is not ready.'))).toBe(true)
    expect(isImageOptimizeFailure(imageNotReady('Image is not ready.'))).toBe(false)
    expect(isImageOptimizeLag(imageNotReady('Image optimization failed.'))).toBe(false)
    expect(isImageOptimizeFailure(imageNotReady('Image optimization failed.'))).toBe(true)
  })

  it('passes over another 409, a non-409 and a non-API failure', () => {
    const driveConflict = new APIError(new Response(null, { status: 409 }), {
      json: { error: { code: 'drive_conflict', message: 'Image is not ready.' } },
    })
    const notFound = new APIError(new Response(null, { status: 404 }), {
      json: { error: { code: 'image_not_ready', message: 'Image is not ready.' } },
    })

    expect(isImageOptimizeLag(driveConflict)).toBe(false)
    expect(isImageOptimizeFailure(driveConflict)).toBe(false)
    expect(isImageOptimizeLag(notFound)).toBe(false)
    expect(isImageOptimizeLag(new Error('Image is not ready.'))).toBe(false)
  })
})
