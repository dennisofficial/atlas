import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createApp } from './create-app'

describe('createApp CORS', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    process.env.TRUSTED_ORIGINS = 'http://localhost:8081, https://app.byatlas.io'
    app = await createApp()
  })
  afterAll(async () => {
    delete process.env.TRUSTED_ORIGINS
    await app.close()
  })

  it('answers a preflight from a trusted origin', async () => {
    const reply = await request(app.getHttpServer())
      .options('/v1/health')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'GET')
    expect(reply.headers['access-control-allow-origin']).toBe('http://localhost:8081')
  })

  it('allows the web origin', async () => {
    const reply = await request(app.getHttpServer())
      .options('/v1/health')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET')
    expect(reply.headers['access-control-allow-origin']).toBe('http://localhost:3001')
  })

  it('does not allow an untrusted origin', async () => {
    const reply = await request(app.getHttpServer())
      .options('/v1/health')
      .set('Origin', 'https://evil.test')
      .set('Access-Control-Request-Method', 'GET')
    expect(reply.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('exposes the bearer token header to trusted origins', async () => {
    const reply = await request(app.getHttpServer())
      .options('/v1/health')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'GET')
    expect(reply.headers['access-control-expose-headers']).toContain('set-auth-token')
  })
})
