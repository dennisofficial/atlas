import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import request from 'supertest'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import {
  checkpoint,
  seedCheckpointOwners,
  THREAD,
  USER_A,
  USER_B,
} from '../../../../test/sandbox-checkpoint-fixture'
import { asJson, seedThreadRow } from '../../../../test/session-seed'
import { LocalPodCheckpointRouter } from './pod-checkpoint.router'

const sessions: Record<string, string> = { 'Bearer session-a': USER_A, 'Bearer session-b': USER_B }

const createApp = () =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      LocalPodCheckpointRouter,
      SessionMiddleware,
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            const userId = sessions[req.headers.authorization ?? '']
            return userId === undefined ? null : { userId, sessionId: 'ses', email: '' }
          },
        },
      },
    ],
  })

const seedPodCheckpoint = async (stored: unknown, revision: number | null) => {
  await seedThreadRow({ id: THREAD, userId: USER_A })
  await db.orm.public.LocalPodCheckpoint.create({
    userId: USER_A,
    threadId: THREAD,
    checkpoint: asJson(stored),
    revision,
  })
}

describe('LocalPodCheckpointRouter.get', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(seedCheckpointOwners)

  const read = (session: string | undefined) => {
    const call = request(app.getHttpServer()).get(
      `/v1/trpc/localPodCheckpoint.get?input=${encodeURIComponent(JSON.stringify({ threadId: THREAD }))}`,
    )
    return session === undefined ? call : call.set({ authorization: `Bearer ${session}` })
  }

  it('answers the mirrored checkpoint to the owner session', async () => {
    await seedPodCheckpoint(checkpoint(), checkpoint().revision)

    const reply = await read('session-a')

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: checkpoint() } } })
  })

  it('404s when the pod never mirrored a checkpoint', async () => {
    await seedThreadRow({ id: THREAD, userId: USER_A })

    expect((await read('session-a')).status).toBe(404)
  })

  it("404s for a signed-in user who does not own the thread's checkpoint", async () => {
    await seedPodCheckpoint(checkpoint(), checkpoint().revision)

    expect((await read('session-b')).status).toBe(404)
  })

  it('answers 401 without a session', async () => {
    await seedPodCheckpoint(checkpoint(), checkpoint().revision)

    expect((await read(undefined)).status).toBe(401)
  })

  it('answers null when the stored payload no longer parses', async () => {
    await seedPodCheckpoint({ revision: 'later' }, 3)

    const reply = await read('session-a')

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { checkpoint: null } } })
  })
})
