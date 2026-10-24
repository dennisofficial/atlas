import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { JSON_BODY_LIMIT } from '../../../_lib/body-limits'
import {
  as,
  createSandboxSelfApp,
  procedurePath,
  SANDBOX_TOKEN,
} from './sandbox-self.router.fixture'

const FIVE_MIB = 5 * 1024 * 1024

describe('tRPC routes under the global JSON body cap', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createSandboxSelfApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('is the same 4mb cap the REST routes get', () => {
    expect(JSON_BODY_LIMIT).toBe('4mb')
  })

  it('refuses a body over the cap with 413 before any procedure runs', async () => {
    const reply = await request(app.getHttpServer())
      .post(procedurePath('stop'))
      .set(as(SANDBOX_TOKEN))
      .set('content-type', 'application/json')
      .send(JSON.stringify({ sessionId: 'x'.repeat(FIVE_MIB) }))

    expect(reply.status).toBe(413)
  })
})
