import { EBootStep, EBootStepState, EThreadStreamFrame } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedUsers } from '../../../../test/session-seed'
import {
  as,
  createSandboxSelfApp,
  procedurePath,
  routerSignals,
  SANDBOX_TOKEN,
} from './sandbox-self.router.fixture'

const post = ({
  app,
  procedure,
  token,
  body,
}: {
  app: INestApplication
  procedure: string
  token: string
  body: unknown
}) =>
  request(app.getHttpServer())
    .post(procedurePath(procedure))
    .set(as(token))
    .send(body as object)

const podEvent = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
})

describe('SandboxSelfRouter signals', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxSelfApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
  })

  it('bootSteps signals a pod change after the steps commit', async () => {
    const frames = routerSignals.framesOf('thr-1')
    frames.length = 0

    const reply = await post({
      app,
      procedure: 'bootSteps',
      token: SANDBOX_TOKEN,
      body: { steps: [{ step: EBootStep.Clone, state: EBootStepState.Running }] },
    })

    expect(reply.status).toBe(200)
    expect(frames).toEqual([{ type: EThreadStreamFrame.Pod }])
  })

  it('events signals the moved head', async () => {
    const frames = routerSignals.framesOf('thr-1')
    frames.length = 0

    const reply = await post({
      app,
      procedure: 'events',
      token: SANDBOX_TOKEN,
      body: { events: [podEvent(1)] },
    })

    expect(reply.status).toBe(200)
    expect(frames).toEqual([{ type: EThreadStreamFrame.Head, head: 1 }])
  })
})
