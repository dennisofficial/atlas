import { describe, expect, it } from 'bun:test'

import { GitCredentialError, readGhAuthToken, type ExecFileFn } from '../gh-auth-token'

const execReturning = (outcome: { stdout: string }): ExecFileFn => {
  return async () => ({ stdout: outcome.stdout, stderr: '' })
}

const execThrowing = (error: Error): ExecFileFn => {
  return async () => {
    throw error
  }
}

describe('readGhAuthToken', () => {
  it('answers the trimmed token gh prints', async () => {
    const token = await readGhAuthToken({ exec: execReturning({ stdout: 'gho_abc123\n' }) })

    expect(token).toBe('gho_abc123')
  })

  it('teaches the install and login when gh is not on the machine', async () => {
    const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })

    const failure = await readGhAuthToken({ exec: execThrowing(enoent) }).catch((error) => error)

    expect(failure).toBeInstanceOf(GitCredentialError)
    expect((failure as Error).message).toContain('install the GitHub CLI')
    expect((failure as Error).message).toContain('gh auth login')
  })

  it('teaches the login when gh is installed but unauthed', async () => {
    const failure = await readGhAuthToken({
      exec: execThrowing(new Error('process exited 1')),
    }).catch((error) => error)

    expect(failure).toBeInstanceOf(GitCredentialError)
    expect((failure as Error).message).toContain('gh auth login')
    expect((failure as Error).message).not.toContain('install the GitHub CLI')
  })

  it('teaches the login when gh answers with an empty token', async () => {
    const failure = await readGhAuthToken({ exec: execReturning({ stdout: '  \n' }) }).catch(
      (error) => error,
    )

    expect(failure).toBeInstanceOf(GitCredentialError)
    expect((failure as Error).message).toContain('gh auth login')
  })
})
