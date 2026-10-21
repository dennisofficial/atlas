import type { INestApplication, Provider, Type } from '@nestjs/common'
import { UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { EnvService } from '../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import { SandboxesService } from '../platform/sandboxes/sandboxes.service'
import { SessionOrSandboxGuard } from '../platform/sessions/session-or-sandbox.guard'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

export const SESSIONS: Record<string, string> = {
  'session-a': 'user-a',
  'session-b': 'user-b',
  'session-c': 'user-c',
}

export const as = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
})

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

export async function buildSessionApp(args: {
  controllers: Type[]
  providers: Provider[]
}): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: args.controllers,
    providers: [
      ...args.providers,
      SessionAuthGuard,
      SessionOrSandboxGuard,
      {
        provide: SecretCipherService,
        useValue: new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
      },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            const userId = SESSIONS[bearerOf(req)]
            if (userId === undefined) return null
            return { userId, sessionId: 'ses', email: '', activeOrganizationId: null }
          },
        },
      },
      {
        provide: SandboxesService,
        useValue: {
          async verifyTokenPrincipal() {
            throw new UnauthorizedException()
          },
        },
      },
    ],
  }).compile()
  const app = module.createNestApplication()
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  await app.init()
  return app
}
