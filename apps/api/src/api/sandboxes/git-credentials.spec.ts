import { describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../github/github.service'
import { SandboxGitCredentials } from './git-credentials'

const ARGS = { userId: 'usr_1', threadId: 'brn_1', remoteUrl: 'https://github.com/compai/atlas.git' }

const brokerWith = (findToken: () => Promise<string | null>) => {
  const github = { findToken: vi.fn(findToken) }
  return {
    github,
    broker: new SandboxGitCredentials(github as unknown as GithubService),
  }
}

describe('SandboxGitCredentials', () => {
  it('answers the operator token when no source is registered', async () => {
    const { broker, github } = brokerWith(async () => 'gho_user')
    await expect(broker.findToken(ARGS)).resolves.toBe('gho_user')
    expect(github.findToken).toHaveBeenCalledWith({ userId: 'usr_1' })
  })

  it('the registered source wins over the default', async () => {
    const { broker, github } = brokerWith(async () => 'gho_user')
    broker.register({ findToken: async () => 'ghs_factory' })
    await expect(broker.findToken(ARGS)).resolves.toBe('ghs_factory')
    expect(github.findToken).not.toHaveBeenCalled()
  })

  it('a source that declines the thread falls through to the default', async () => {
    const { broker } = brokerWith(async () => 'gho_user')
    broker.register({ findToken: async () => undefined })
    await expect(broker.findToken(ARGS)).resolves.toBe('gho_user')
  })

  it('a failing source falls back to the default rather than losing the workspace', async () => {
    const { broker } = brokerWith(async () => 'gho_user')
    broker.register({
      findToken: async () => {
        throw new Error('github is down')
      },
    })
    await expect(broker.findToken(ARGS)).resolves.toBe('gho_user')
  })
})
