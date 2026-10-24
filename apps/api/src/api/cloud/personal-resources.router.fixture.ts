import { UnauthorizedException, type INestApplication, type Provider } from '@nestjs/common'
import request from 'supertest'
import { EnvService } from '../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { SessionMiddleware } from '../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../_module/trpc/trpc-middleware.fixture'
import { SandboxesService } from '../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../platform/sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../platform/sessions/session-or-sandbox.middleware'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const SESSIONS: Record<string, string> = {
  'session-a': 'user-a',
  'session-b': 'user-b',
  'session-c': 'user-c',
}
const POD_TOKENS: Record<string, { threadId: string; userId: string }> = {
  'pod-token-a': { threadId: 'thread-pod-a', userId: 'user-a' },
  'pod-token-b': { threadId: 'thread-pod-b', userId: 'user-b' },
}
const SANDBOX_TOKENS: Record<string, { id: string; threadId: string; userId: string }> = {
  'sandbox-token-a': { id: 'sbx-a', threadId: 'thread-sbx-a', userId: 'user-a' },
}

export const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

export const createPersonalApp = (providers: Provider[]): Promise<INestApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      ...providers,
      SessionMiddleware,
      SessionOrSandboxMiddleware,
      { provide: SecretCipherService, useValue: cipher },
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
          async verifyTokenPrincipal(args: { token: string }) {
            const pod = POD_TOKENS[args.token]
            if (pod !== undefined) return { kind: ETokenPrincipalKind.Pod, ...pod }
            const sandbox = SANDBOX_TOKENS[args.token]
            if (sandbox !== undefined) return { kind: ETokenPrincipalKind.Sandbox, ...sandbox }
            throw new UnauthorizedException()
          },
          async assertThreadInFamily() {
            throw new Error('a threadless personal route must never reach the thread-family check')
          },
        },
      },
    ],
  })

type Call = {
  app: INestApplication
  procedure: string
  token?: string | undefined
  input?: object | undefined
}

export const trpcQuery = ({ app, procedure, token, input }: Call) => {
  const call = request(app.getHttpServer()).get(`/v1/trpc/${procedure}`)
  const withInput = input === undefined ? call : call.query({ input: JSON.stringify(input) })
  return token === undefined ? withInput : withInput.set(as(token))
}

export const trpcMutate = ({ app, procedure, token, input }: Call) => {
  const call = request(app.getHttpServer()).post(`/v1/trpc/${procedure}`)
  const authed = token === undefined ? call : call.set(as(token))
  return input === undefined ? authed : authed.send(input)
}
