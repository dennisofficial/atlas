import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedUsers, threadById } from '../../../../test/session-seed'
import {
  as,
  createSandboxSelfApp,
  POD_TOKEN,
  procedurePath,
  SANDBOX_TOKEN,
} from './sandbox-self.router.fixture'

describe('SandboxSelfRouter.activity', () => {
  useTestDatabase()
  let app: INestApplication
  const send = (token: string | undefined, body: object) => {
    const call = request(app.getHttpServer()).post(procedurePath('activity'))
    return (token === undefined ? call : call.set(as(token))).send(body)
  }

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

  it('writes working, awaiting and activityAt on the token thread', async () => {
    const reply = await send(SANDBOX_TOKEN, { working: true, awaiting: 'approval' })

    const row = await threadById('thr-1')
    expect(reply.status).toBe(200)
    expect(row?.working).toBe(true)
    expect(row?.awaiting).toBe('approval')
    expect(row?.activityAt).toBeInstanceOf(Date)
  })

  it('records the outcome on end and clears it when a new turn starts', async () => {
    await send(SANDBOX_TOKEN, { working: true, awaiting: null })
    await send(SANDBOX_TOKEN, { working: false, awaiting: null, lastOutcome: 'failed' })
    expect((await threadById('thr-1'))?.lastOutcome).toBe('failed')
    expect((await threadById('thr-1'))?.working).toBe(false)

    await send(SANDBOX_TOKEN, { working: false, awaiting: null })
    expect((await threadById('thr-1'))?.lastOutcome).toBe('failed')

    await send(SANDBOX_TOKEN, { working: true, awaiting: null })
    expect((await threadById('thr-1'))?.lastOutcome).toBeNull()
  })

  it('accepts a local pod lease token', async () => {
    const reply = await send(POD_TOKEN, { working: true, awaiting: 'input' })

    expect(reply.status).toBe(200)
    expect((await threadById('thr-1'))?.awaiting).toBe('input')
  })

  it('answers 401 without a known token', async () => {
    expect((await send(undefined, { working: true, awaiting: null })).status).toBe(401)
    expect((await send('session-a', { working: true, awaiting: null })).status).toBe(401)
  })
})
