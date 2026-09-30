import { describe, expect, it } from 'bun:test'

import { APIError } from '@vercel/sandbox'

import { isDriveAttachedConflict, isDriveDeleteConflict } from '../vercel-errors'

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
