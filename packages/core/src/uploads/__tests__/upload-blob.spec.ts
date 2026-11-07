import { describe, expect, test } from 'bun:test'

import { isOwnedUpload, uploadBlobPathnameOf, uploadBlobPrefixOf } from '../upload-blob'

const uploadId = '0b6c1f9e-2d4a-4c1b-9f3e-7a2b5c8d1e40'

const uploadOf = (overrides: { uploadId?: string; name?: string; pathname?: string } = {}) => {
  const name = overrides.name ?? 'deploy.sh'
  const id = overrides.uploadId ?? uploadId
  return {
    uploadId: id,
    name,
    pathname: overrides.pathname ?? uploadBlobPathnameOf({ userId: 'user-a', uploadId: id, name }),
  }
}

describe('upload blob pathnames', () => {
  test('lay out the prefix, user, upload id and name', () => {
    expect(uploadBlobPrefixOf('user-a')).toBe('composer-uploads/user-a/')
    expect(uploadBlobPathnameOf({ userId: 'user-a', uploadId, name: 'a b.txt' })).toBe(
      `composer-uploads/user-a/${uploadId}/a b.txt`,
    )
  })
})

describe('isOwnedUpload', () => {
  test('accepts an upload stored under its owner', () => {
    expect(isOwnedUpload({ upload: uploadOf(), userId: 'user-a' })).toBe(true)
  })

  test('refuses an upload stored under another user', () => {
    expect(isOwnedUpload({ upload: uploadOf(), userId: 'user-b' })).toBe(false)
  })

  test('refuses a pathname that does not match the id and name', () => {
    const upload = uploadOf({ pathname: `composer-uploads/user-a/${uploadId}/other.sh` })
    expect(isOwnedUpload({ upload, userId: 'user-a' })).toBe(false)
  })

  test('refuses an upload id that is not a uuid', () => {
    expect(isOwnedUpload({ upload: uploadOf({ uploadId: '../x' }), userId: 'user-a' })).toBe(false)
  })

  test.each(['', '.', '..', 'a/b', 'a\\b', 'a\u0000b', 'a\nb'])(
    'refuses the unsafe name %j',
    (name) => {
      expect(isOwnedUpload({ upload: uploadOf({ name }), userId: 'user-a' })).toBe(false)
    },
  )
})
