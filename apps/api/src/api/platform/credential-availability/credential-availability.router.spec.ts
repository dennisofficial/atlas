import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  ECredentialAvailability,
  ECredentialFence,
  EAdmissionCompletion,
  EAvailabilityControl,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
} from '@dltech/atlas-wire'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { as, createMiddlewareApp } from '../../../_module/trpc/trpc-middleware.fixture'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../sessions/session-or-sandbox.middleware'
import { CredentialAvailabilityRouter } from './credential-availability.router'
import { CredentialAvailabilityService } from './credential-availability.service'

const USERS: Record<string, string> = {
  'token-a': 'user-a',
  'token-b': 'user-b',
}
const key = {
  accountId: 'acc-1',
  providerId: 'anthropic',
  modelId: 'claude-x',
}
const revision = { fence: ECredentialFence.Replaced, value: 0 }
const input = { key, revision }

describe('CredentialAvailabilityRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const url = (procedure: string) => `/v1/trpc/credentialAvailability.${procedure}`
  const mutate = (procedure: string, token: string | undefined, body: unknown) => {
    const call = request(app.getHttpServer()).post(url(procedure))
    return (token === undefined ? call : call.set(as(token))).send(body as object)
  }
  const inspect = (token: string | undefined) => {
    const call = request(app.getHttpServer()).get(url('inspect'))
    return (token === undefined ? call : call.set(as(token))).query({
      input: JSON.stringify(input),
    })
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: 100_000,
      providers: [
        CredentialAvailabilityRouter,
        CredentialAvailabilityService,
        SessionMiddleware,
        SessionOrSandboxMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = USERS[(req.headers.authorization ?? '').replace(/^Bearer /, '')]
              return userId === undefined ? null : { userId, sessionId: 's', email: '' }
            },
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(args: { token: string }) {
              if (args.token === 'pod-token') {
                return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'user-p' }
              }
              if (args.token === 'sandbox-token') {
                return {
                  kind: ETokenPrincipalKind.Sandbox,
                  id: 'sbx-1',
                  threadId: 'thr-1',
                  userId: 'user-s',
                }
              }
              throw new UnauthorizedException()
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b', 'user-s', 'user-p')
  })

  it('answers 401 on every procedure without a session', async () => {
    expect((await inspect(undefined)).status).toBe(401)
    expect((await mutate('admit', undefined, input)).status).toBe(401)
    expect(
      (
        await mutate('control', undefined, {
          ...input,
          action: EAvailabilityControl.Pause,
        })
      ).status,
    ).toBe(401)
  })

  it('admits, records a failure and blocks the next admit, scoped to the session user', async () => {
    const admitted = await mutate('admit', 'token-a', input)
    expect(admitted.status).toBe(200)
    const { permit } = admitted.body.result.data
    expect(permit.permitId).toEqual(expect.any(String))

    const completed = await mutate('complete', 'token-a', {
      permit,
      completion: {
        outcome: EAdmissionCompletion.Failed,
        failure: {
          kind: EProviderFailureKind.Auth,
          scope: EProviderFailureScope.Credential,
          retry: EProviderRetry.Never,
          message: 'bad key',
        },
      },
    })
    expect(completed.status).toBe(200)

    const snapshot = await inspect('token-a')
    expect(snapshot.body.result.data.availability).toBe(ECredentialAvailability.AuthRejected)
    expect((await inspect('token-b')).body.result.data.availability).toBe(
      ECredentialAvailability.Available,
    )
    expect((await db.orm.public.CredentialAvailability.all())[0]?.userId).toBe('user-a')
  })

  it('rejects a caller-supplied userId and forged permit fields', async () => {
    expect((await mutate('admit', 'token-a', { ...input, userId: 'user-b' })).status).toBe(400)
    expect(
      (
        await mutate('complete', 'token-a', {
          permit: { ...input, probe: false },
          completion: {},
        })
      ).status,
    ).toBe(400)
  })

  it('pauses and resumes', async () => {
    const paused = await mutate('control', 'token-a', {
      ...input,
      action: EAvailabilityControl.Pause,
    })
    expect(paused.body.result.data.availability).toBe(ECredentialAvailability.Paused)
    const blocked = await mutate('admit', 'token-a', input)
    expect(blocked.body.result.data.admitted).toBe(false)
    const resumed = await mutate('control', 'token-a', {
      ...input,
      action: EAvailabilityControl.Resume,
    })
    expect(resumed.body.result.data.availability).toBe(ECredentialAvailability.Available)
  })

  describe('sandbox and pod tokens', () => {
    const settle = (permit: unknown) => ({
      permit,
      completion: {
        outcome: EAdmissionCompletion.Failed,
        failure: {
          kind: EProviderFailureKind.Quota,
          scope: EProviderFailureScope.Credential,
          retry: EProviderRetry.Never,
          message: 'quota exhausted',
        },
      },
    })

    it('lets a sandbox token admit, complete and inspect as its owner', async () => {
      const admitted = await mutate('admit', 'sandbox-token', input)
      expect(admitted.status).toBe(200)
      const { permit } = admitted.body.result.data

      expect((await mutate('complete', 'sandbox-token', settle(permit))).status).toBe(200)

      const snapshot = await inspect('sandbox-token')
      expect(snapshot.body.result.data.availability).toBe(ECredentialAvailability.QuotaExhausted)
      expect((await inspect('token-a')).body.result.data.availability).toBe(
        ECredentialAvailability.Available,
      )
      expect((await db.orm.public.CredentialAvailability.all())[0]?.userId).toBe('user-s')
    })

    it('lets a pod token admit and promote a probe as its owner', async () => {
      const admitted = await mutate('admit', 'pod-token', input)
      expect(admitted.status).toBe(200)
      expect(admitted.body.result.data.admitted).toBe(true)
      const { permit } = admitted.body.result.data
      expect(
        (
          await mutate('promoteProbe', 'pod-token', {
            permit,
            failure: settle(permit).completion.failure,
          })
        ).status,
      ).toBe(200)
      expect((await inspect('pod-token')).status).toBe(200)
    })

    it('rejects an unknown bearer on admit', async () => {
      expect((await mutate('admit', 'forged-token', input)).status).toBe(401)
    })

    it('keeps control session-only', async () => {
      const body = { ...input, action: EAvailabilityControl.Pause }

      expect((await mutate('control', 'sandbox-token', body)).status).toBe(401)
      expect((await mutate('control', 'pod-token', body)).status).toBe(401)
      expect((await mutate('control', 'token-a', body)).status).toBe(200)
    })
  })
})
