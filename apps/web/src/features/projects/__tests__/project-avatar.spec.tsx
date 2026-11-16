import { describe, expect, test } from 'bun:test'

import { ownerAvatarUrlOf } from '../project-avatar'

describe('ownerAvatarUrlOf', () => {
  test('points at the GitHub avatar of the repository owner', () => {
    expect(ownerAvatarUrlOf('dennisofficial/atlas')).toBe(
      'https://github.com/dennisofficial.png?size=80',
    )
  })

  test('has no avatar for a project without a repository', () => {
    expect(ownerAvatarUrlOf(null)).toBeNull()
  })

  test('has no avatar when the repository has no owner', () => {
    expect(ownerAvatarUrlOf('/atlas')).toBeNull()
  })
})
