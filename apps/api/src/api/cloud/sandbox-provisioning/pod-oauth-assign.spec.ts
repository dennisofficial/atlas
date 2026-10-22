import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import {
  cipher,
  launchWith,
  podLaunchWith,
  seedBase,
  seedThread,
  sandboxRows,
} from './sandbox-provisioning.fixture'

const FIRST = { sendId: 'snd-oauth', text: 'hi' }

const assignments = () => db.orm.public.OauthConnectionSandbox.all()

const seedConnection = async (args: {
  id: string
  userId: string
  provider?: string
  status?: string
}): Promise<void> => {
  await db.orm.public.OauthConnection.create({
    id: args.id,
    userId: args.userId,
    provider: args.provider ?? 'anthropic',
    status: args.status ?? 'active',
    sealedTokens: cipher.encrypt('{}'),
    authorizationId: args.id,
    generation: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe('pod oauth assignment at launch', () => {
  useTestDatabase()

  it('assigns every active connection of the thread creator in the claim transaction', async () => {
    await seedBase()
    await seedConnection({ id: 'oauth-a', userId: 'usr-1', provider: 'anthropic' })
    await seedConnection({ id: 'oauth-b', userId: 'usr-1', provider: 'openai' })
    await seedConnection({ id: 'oauth-expired', userId: 'usr-1', status: 'expired' })
    await seedUser({ db, id: 'usr-2' })
    await seedConnection({ id: 'oauth-other', userId: 'usr-2' })
    const { service } = launchWith()

    const reply = await service.launch({
      userId: 'usr-1',
      draft: { projectId: 'prj-1' },
      firstMessage: FIRST,
    })

    const [claimed] = await sandboxRows()
    expect(await assignments()).toMatchObject([
      { connectionId: 'oauth-a', sandboxId: claimed?.id },
      { connectionId: 'oauth-b', sandboxId: claimed?.id },
    ])
    expect(reply.provision.state).toBe(ESandboxProvisionState.Booting)
  })

  it('re-assigns the connections to the fresh sandbox id when a parked pod is relaunched', async () => {
    await seedThread()
    await seedConnection({ id: 'oauth-a', userId: 'usr-1' })
    const { service } = launchWith()
    const { pod } = podLaunchWith()
    const first = await service.launch({ userId: 'usr-1', draft: {}, firstMessage: FIRST })
    const [firstClaim] = await sandboxRows()
    expect(await assignments()).toMatchObject([
      { connectionId: 'oauth-a', sandboxId: firstClaim?.id },
    ])

    const relaunched = await pod.launch({
      thread: (await db.orm.public.Thread.first({ id: first.thread.id }))!,
      existing: firstClaim ?? null,
    })

    expect(relaunched.reply.state).toBe(ESandboxProvisionState.Booting)
    expect(await assignments()).toMatchObject([
      { connectionId: 'oauth-a', sandboxId: firstClaim?.id },
    ])
  })
})
