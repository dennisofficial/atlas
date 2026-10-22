import { describe, expect, it } from 'bun:test'

import { repoNameOfRemoteUrl } from '../repo-name'

describe('repoNameOfRemoteUrl', () => {
  it('names the clone directory of an https remote', () => {
    expect(repoNameOfRemoteUrl('https://github.com/dennisofficial/atlas')).toBe('atlas')
  })

  it('strips a .git suffix', () => {
    expect(repoNameOfRemoteUrl('https://github.com/dennisofficial/atlas.git')).toBe('atlas')
  })

  it('reads scp-style ssh remotes', () => {
    expect(repoNameOfRemoteUrl('git@github.com:dennisofficial/atlas.git')).toBe('atlas')
  })

  it('reads ssh:// remotes', () => {
    expect(repoNameOfRemoteUrl('ssh://git@github.com/dennisofficial/atlas')).toBe('atlas')
  })

  it('reads ssh:// remotes with a port', () => {
    expect(repoNameOfRemoteUrl('ssh://git@github.com:22/dennisofficial/atlas.git')).toBe('atlas')
  })

  it('ignores trailing slashes', () => {
    expect(repoNameOfRemoteUrl('https://github.com/dennisofficial/atlas/')).toBe('atlas')
  })

  it('falls back to workspace when the url has no name tail', () => {
    expect(repoNameOfRemoteUrl('https://github.com/')).toBe('workspace')
  })
})
