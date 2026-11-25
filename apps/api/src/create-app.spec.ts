import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import request from 'supertest'
import { corsOptionsFor, originAllowed } from './create-app'

const trustedOrigins = new Set([
  'http://localhost:8081',
  'https://app.byatlas.io',
  'http://localhost:3001',
])
const agentOrigins = ['https://api.byatlas.io']

const allowed = (origin: string | undefined): boolean =>
  originAllowed({ origin, trustedOrigins, agentOrigins })

describe('createApp CORS allowlist', () => {
  it('allows a trusted origin', () => {
    expect(allowed('http://localhost:8081')).toBe(true)
  })

  it('allows the web origin', () => {
    expect(allowed('http://localhost:3001')).toBe(true)
  })

  it('allows an origin the agent lists', () => {
    expect(allowed('https://api.byatlas.io')).toBe(true)
  })

  it('does not allow an untrusted origin', () => {
    expect(allowed('https://evil.test')).toBe(false)
  })

  it('allows a request without an origin', () => {
    expect(allowed(undefined)).toBe(true)
  })
})

const corsOptions = corsOptionsFor({ trustedOrigins, agentOrigins })

describe('createApp credentialed CORS', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({}).compile()
    app = module.createNestApplication()
    app.enableCors(corsOptions)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const preflight = (origin: string) =>
    request(app.getHttpServer())
      .options('/v1/trpc/settings.list')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')

  it('answers a credentialed preflight from the web origin with its own origin', async () => {
    const response = await preflight('http://localhost:3001')

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('credentials a preflight from the agent origin', async () => {
    const response = await preflight('https://api.byatlas.io')

    expect(response.headers['access-control-allow-origin']).toBe('https://api.byatlas.io')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('never echoes an untrusted origin, so its credentialed call is refused', async () => {
    const response = await preflight('https://evil.test')

    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.test')
  })

  it('resolves the allowed origin per request rather than sending a wildcard', () => {
    expect(corsOptions.credentials).toBe(true)
    expect(corsOptions.origin).toBeFunction()
  })
})
