import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  checkpoint,
  seedCheckpointOwners,
  THREAD,
  USER_A,
} from '../../../../test/sandbox-checkpoint-fixture'
import { seedThreadRow } from '../../../../test/session-seed'
import { createSandboxRoutersApp, putCheckpoint } from './sandbox-routers.fixture'
import { mintSessionToken } from './sandbox-tokens'

const pod = mintSessionToken()

describe('SandboxCheckpointRouter.put from a local pod lease token', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxRoutersApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  it('answers 401 and writes nothing', async () => {
    await seedThreadRow({ id: THREAD, userId: USER_A })
    await db.orm.public.LocalPodLease.create({
      userId: USER_A,
      threadId: THREAD,
      tokenHash: pod.tokenHash,
    })

    const reply = await putCheckpoint({ app, token: pod.token, body: checkpoint() })

    expect(reply.status).toBe(401)
  })
})
