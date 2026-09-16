import type { INestApplication } from '@nestjs/common'
import { ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { McpServersController } from '../src/api/mcp-servers/mcp-servers.controller'
import { McpServersService } from '../src/api/mcp-servers/mcp-servers.service'

vi.mock('../src/db', () => ({ db: {} }))

describe('McpServersController validation (in-process)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [McpServersController],
      providers: [
        McpServersService,
        {
          provide: SecretCipherService,
          useValue: new SecretCipherService(
            new EnvService({
              SECRETS_ENCRYPTION_KEY:
                'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            }),
          ),
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => unknown } }) => {
          const request = context.switchToHttp().getRequest() as AuthenticatedRequest
          request.auth = { userId: 'test-user', sessionId: 's', email: 't@example.com', activeOrganizationId: null }
          return true
        },
      })
      .compile()

    app = module.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts a well-formed stdio spec', async () => {
    const response = await request(app.getHttpServer())
      .put('/mcp-servers/fs')
      .send({ transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] } })

    expect(response.status).not.toBe(400)
  })

  it('accepts a disabled server with no transport', async () => {
    const response = await request(app.getHttpServer())
      .put('/mcp-servers/paused')
      .send({ disabled: true })

    expect(response.status).not.toBe(400)
  })

  it('rejects an unknown property', async () => {
    await request(app.getHttpServer())
      .put('/mcp-servers/fs')
      .send({ transport: { kind: 'stdio', command: 'npx' }, bogus: true })
      .expect(400)
  })

  it('rejects an unknown transport property', async () => {
    await request(app.getHttpServer())
      .put('/mcp-servers/fs')
      .send({ transport: { kind: 'stdio', command: 'npx', bogus: true } })
      .expect(400)
  })

  it('rejects a transport kind outside the union', async () => {
    await request(app.getHttpServer())
      .put('/mcp-servers/fs')
      .send({ transport: { kind: 'sse', url: 'https://mcp.example.com' } })
      .expect(400)
  })

  it('rejects a transport that is not an object', async () => {
    await request(app.getHttpServer())
      .put('/mcp-servers/fs')
      .send({ transport: 'stdio' })
      .expect(400)
  })

  it('rejects a spec with neither transport nor disabled', async () => {
    await request(app.getHttpServer()).put('/mcp-servers/empty').send({ trusted: true }).expect(400)
  })
})
