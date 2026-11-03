import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { agentHost, createV2AgentHostApp } from './v2-agent-host.router.fixture'

const TOKEN = 'a'.repeat(32)

describe('V2AgentHostRouter', () => {
  let app: NestExpressApplication

  const config = (token: string | undefined, input: object = { sessionId: 's1' }) => {
    const sent = request(app.getHttpServer())
      .get('/v1/trpc/v2AgentHost.config')
      .query({ input: JSON.stringify(input) })
    return token === undefined ? sent : sent.set(as(token))
  }

  beforeEach(() => {
    for (const fn of Object.values(agentHost)) fn.mockReset()
  })

  afterEach(() => app.close())

  describe('with a configured token', () => {
    beforeEach(async () => {
      app = await createV2AgentHostApp({ token: TOKEN })
    })

    it('refuses a request without a token', async () => {
      expect((await config(undefined)).status).toBe(401)
      expect(agentHost.config).not.toHaveBeenCalled()
    })

    it('refuses a wrong token', async () => {
      expect((await config(`${'b'.repeat(32)}`)).status).toBe(401)
      expect((await config('short')).status).toBe(401)
      expect(agentHost.config).not.toHaveBeenCalled()
    })

    it('answers with the right token', async () => {
      const body = {
        userId: 'user-a',
        projectId: 'proj-a',
        vercel: { configured: false, gap: 'user-credential' },
        config: {
          settings: {},
          secrets: [],
          harnessSecrets: [],
          mcpServers: [],
          fileMounts: [],
          provenance: {},
        },
        revision: 'r1',
        expiresAt: '2026-11-03T12:05:00.000Z',
      }
      agentHost.config.mockResolvedValue(body)

      const response = await config(TOKEN)

      expect(response.status).toBe(200)
      expect(response.body.result.data).toEqual(body)
      expect(agentHost.config).toHaveBeenCalledWith({ sessionId: 's1' })
    })

    it('issues a model access token', async () => {
      agentHost.modelAccessToken.mockResolvedValue({
        accessToken: 'at',
        expiresAt: '2026-11-03T13:00:00.000Z',
        refreshAfter: '2026-11-03T12:30:00.000Z',
        generation: 3,
        authorizationId: 'conn-1',
      })

      const response = await request(app.getHttpServer())
        .get('/v1/trpc/v2AgentHost.modelAccessToken')
        .set(as(TOKEN))
        .query({ input: JSON.stringify({ sessionId: 's1', connectionId: 'conn-1' }) })

      expect(response.status).toBe(200)
      expect(response.body.result.data.accessToken).toBe('at')
      expect(agentHost.modelAccessToken).toHaveBeenCalledWith({
        sessionId: 's1',
        connectionId: 'conn-1',
      })
    })

    it('answers the github token', async () => {
      agentHost.githubToken.mockResolvedValue({ token: 'ghp_x' })

      const response = await request(app.getHttpServer())
        .get('/v1/trpc/v2AgentHost.githubToken')
        .set(as(TOKEN))
        .query({ input: JSON.stringify({ sessionId: 's1' }) })

      expect(response.status).toBe(200)
      expect(response.body.result.data).toEqual({ token: 'ghp_x' })
    })

    it('validates the input', async () => {
      const response = await config(TOKEN, { sessionId: '' })
      expect(response.status).toBe(400)
      expect(agentHost.config).not.toHaveBeenCalled()
    })
  })

  describe('with the token unset', () => {
    beforeEach(async () => {
      app = await createV2AgentHostApp()
    })

    it('refuses everything, even with a plausible token', async () => {
      expect((await config(TOKEN)).status).toBe(401)
      expect(agentHost.config).not.toHaveBeenCalled()
    })
  })
})
