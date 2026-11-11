import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { describe, expect, it, vi } from 'bun:test'
import { buildCredentialsOf } from './artifact-sandbox'

const credentialPort = () => {
  const forThread = vi.fn(async () => ({
    token: 'thread-token',
    teamId: 'team',
    projectId: 'prj',
    ownerCredential: true,
    userId: 'user-a',
  }))
  const forUser = vi.fn(async (args: { userId: string }) => ({
    token: 'user-token',
    teamId: 'team',
    projectId: 'prj',
    userId: args.userId,
  }))
  const credentials = { forThread, forUser } as unknown as SandboxCredentials
  return { credentials, forThread, forUser }
}

describe('buildCredentialsOf', () => {
  it('resolves a build with no thread through the publisher’s own credential', async () => {
    const { credentials, forThread, forUser } = credentialPort()

    const resolved = await buildCredentialsOf({ credentials, owner: { userId: 'user-a' } })

    expect(resolved).toEqual({
      token: 'user-token',
      teamId: 'team',
      projectId: 'prj',
      userId: 'user-a',
    })
    expect(forUser).toHaveBeenCalledWith({ userId: 'user-a' })
    expect(forThread).not.toHaveBeenCalled()
  })

  it('keeps a thread build on exactly the thread credential it had before', async () => {
    const { credentials, forThread, forUser } = credentialPort()

    const resolved = await buildCredentialsOf({ credentials, owner: { threadId: 'thread-a' } })

    expect(resolved).toEqual({
      token: 'thread-token',
      teamId: 'team',
      projectId: 'prj',
      ownerCredential: true,
      userId: 'user-a',
    })
    expect(forThread).toHaveBeenCalledWith({ threadId: 'thread-a' })
    expect(forUser).not.toHaveBeenCalled()
  })
})
