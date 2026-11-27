import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { VersioningType, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { GithubOauthController } from '../github-oauth.controller'
import { GithubRedirectService } from '../github-redirect.service'

const calls: unknown[] = []
let app: INestApplication
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [GithubOauthController],
    providers: [
      {
        provide: GithubRedirectService,
        useValue: {
          callback: async (args: { state: string }) => {
            calls.push(args)
            return args.state === 'desktop'
              ? {
                  kind: 'page',
                  html: '<h1>Continue to Atlas</h1>',
                  clearCookie: 'atlas_return=; Max-Age=0',
                }
              : {
                  kind: 'redirect',
                  location: 'https://byatlas.io/settings/integrations?atlasReturn=connected',
                  clearCookie: 'atlas_return=; Max-Age=0',
                }
          },
        },
      },
    ],
  }).compile()
  app = module.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI })
  await app.init()
})
afterAll(async () => {
  await app.close()
})

describe('GitHub OAuth callback route', () => {
  it('serves the registered versioned callback and forwards provider fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/github/oauth/callback?state=state&code=code&error=denied&error_description=No')
      .set('cookie', 'atlas_return=sealed')
    expect(response.status).toBe(302)
    expect(response.headers.location).toContain('atlasReturn=connected')
    expect(response.headers['set-cookie']).toEqual(['atlas_return=; Max-Age=0'])
    expect(response.headers['cache-control']).toBe('no-store')
    expect(calls.at(-1)).toEqual({
      state: 'state',
      code: 'code',
      error: 'denied',
      errorDescription: 'No',
      cookieHeader: 'atlas_return=sealed',
    })
  })
  it('serves the framework deep-link page for a native surface', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v1/github/oauth/callback?state=desktop',
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('Continue to Atlas')
  })
})
