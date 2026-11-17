import type { NestExpressApplication } from '@nestjs/platform-express'
import { OPERATOR_ANSWERS } from '@dltech/atlas-agent-host/host/tokens'
import { afterEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createOauthApp,
  mutate,
  SESSIONS,
  sessionVerifier,
} from '../../platform/oauth-connections/oauth-connections.router.fixture'
import { OperatorRequestsRouter } from './operator-requests.router'

type Answered = { userId: string; body: unknown }

const appWith = (answers: {
  answer: (input: Answered) => Promise<{ status: number; body: unknown }>
}): Promise<NestExpressApplication> =>
  createOauthApp([
    OperatorRequestsRouter,
    SessionMiddleware,
    { provide: SESSION_VERIFIER, useValue: sessionVerifier(SESSIONS) },
    { provide: OPERATOR_ANSWERS, useValue: answers },
  ])

const BODY = { sessionId: 'ses_1', callId: 'call_1', value: 'yes' }

describe('OperatorRequestsRouter', () => {
  let app: NestExpressApplication

  afterEach(() => app.close())

  it('refuses a call without a session', async () => {
    app = await appWith({ answer: async () => ({ status: 200, body: {} }) })

    const response = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      body: BODY,
    })

    expect(response.status).toBe(401)
  })

  it('answers for the session user and accepts a cancel', async () => {
    const answered: Answered[] = []
    app = await appWith({
      answer: async (input) => {
        answered.push(input)
        return { status: 200, body: {} }
      },
    })

    const value = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      token: 'session-a',
      body: BODY,
    })
    const cancel = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      token: 'session-a',
      body: { sessionId: 'ses_1', callId: 'call_1', cancel: true },
    })

    expect(value.status).toBe(200)
    expect(cancel.status).toBe(200)
    expect(answered[1]?.body).toEqual({ sessionId: 'ses_1', callId: 'call_1', cancel: true })
    expect(typeof answered[0]?.userId).toBe('string')
  })

  it('refuses a body that names neither a value nor a cancel', async () => {
    app = await appWith({ answer: async () => ({ status: 200, body: {} }) })

    const response = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      token: 'session-a',
      body: { sessionId: 'ses_1', callId: 'call_1' },
    })

    expect(response.status).toBe(400)
  })

  it('turns a refusal into the matching http status', async () => {
    app = await appWith({ answer: async () => ({ status: 404, body: { reason: 'session' } }) })

    const response = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      token: 'session-a',
      body: BODY,
    })

    expect(response.status).toBe(404)
  })

  it('answers 503 when the host is not mounted', async () => {
    app = await createOauthApp([
      OperatorRequestsRouter,
      SessionMiddleware,
      { provide: SESSION_VERIFIER, useValue: sessionVerifier(SESSIONS) },
    ])

    const response = await mutate({
      app,
      procedure: 'operatorRequests.answer',
      token: 'session-a',
      body: BODY,
    })

    expect(response.status).toBe(503)
  })
})
