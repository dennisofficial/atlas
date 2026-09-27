import { describe, expect, it } from 'bun:test'

import { credentialedRemoteOf, httpsRemoteOf } from '../materialize-workspace'

describe('remote urls', () => {
  it('reaches an ssh remote over https so a token can authenticate it', () => {
    expect(httpsRemoteOf('git@github.com:dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
    expect(httpsRemoteOf('ssh://git@github.com/dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
    expect(httpsRemoteOf('https://github.com/dennisofficial/atlas.git')).toBe(
      'https://github.com/dennisofficial/atlas.git',
    )
  })

  it('leaves the remote alone when there is no token to carry', () => {
    expect(
      credentialedRemoteOf({ remoteUrl: 'git@github.com:dennisofficial/atlas.git', token: null }),
    ).toBe('git@github.com:dennisofficial/atlas.git')
  })
})
