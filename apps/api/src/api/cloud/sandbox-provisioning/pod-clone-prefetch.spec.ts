import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { clonePrefetcherOf } from './pod-clone-prefetch'
import { cipher, fakeSandbox, seedThread } from './sandbox-provisioning.fixture'

const argsOf = (projectId: string | null) => ({
  userId: 'usr-1',
  projectId,
  cipher,
  log: () => undefined,
})

describe('clonePrefetcherOf', () => {
  useTestDatabase()

  it('starts one detached clone of the project repo with the owner token', async () => {
    await seedThread()
    await db.orm.public.Project.where({ id: 'prj-1' }).update({
      repo: 'acme/app',
      baseBranch: 'develop',
    })
    await db.orm.public.GithubConnection.create({
      id: 'gh_1',
      login: 'octo',
      scopes: 'repo',
      sealedToken: cipher.encrypt('gho_secret'),
      userId: 'usr-1',
    })
    const { sandbox, runCommand } = fakeSandbox()

    await clonePrefetcherOf(argsOf('prj-1'))(sandbox)

    expect(runCommand).toHaveBeenCalledTimes(1)
    const call = runCommand.mock.calls[0] as unknown as [{ args: string[]; detached: boolean }]
    expect(call[0].detached).toBe(true)
    expect(call[0].args[1]).toContain('x-access-token:gho_secret@github.com/acme/app.git')
    expect(call[0].args[1]).toContain("--branch 'develop'")
  })

  it('does nothing for a project without a repo or a thread without a project', async () => {
    await seedThread()
    const { sandbox, runCommand } = fakeSandbox()

    await clonePrefetcherOf(argsOf('prj-1'))(sandbox)
    await clonePrefetcherOf(argsOf(null))(sandbox)

    expect(runCommand).not.toHaveBeenCalled()
  })
})
