import type { NestExpressApplication } from '@nestjs/platform-express'
import { ESandboxProvisionState, sandboxProvisionReplySchema } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { DISPATCH_FAILED_MESSAGE } from './pod-launch.service'
import { callMutation, createRouterApp } from './sandbox-provisioning.router.fixture'
import { SandboxProvisioningRouter } from './sandbox-provisioning.router'
import { fakeDispatcher, provisioningWith, seedThread } from './sandbox-provisioning.fixture'
import { SandboxProvisioningService } from './sandbox-provisioning.service'

describe('SandboxProvisioningRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication
  let dispatch: ReturnType<typeof provisioningWith>['dispatch']
  let failingApp: NestExpressApplication

  beforeAll(async () => {
    const provisioning = provisioningWith()
    dispatch = provisioning.dispatch
    app = await createRouterApp([
      SandboxProvisioningRouter,
      { provide: SandboxProvisioningService, useValue: provisioning.service },
    ])
    const failing = provisioningWith({
      dispatcher: fakeDispatcher({ failWith: new Error('trigger is down') }),
    })
    failingApp = await createRouterApp([
      SandboxProvisioningRouter,
      { provide: SandboxProvisioningService, useValue: failing.service },
    ])
  })

  afterAll(async () => {
    await app.close()
    await failingApp.close()
  })

  beforeEach(async () => {
    dispatch.mockClear()
    await seedThread()
    await seedUsers('usr-2')
  })

  const provision = ({
    token,
    input = { threadId: 'thr-1' },
    target = app,
  }: {
    token?: string
    input?: unknown
    target?: NestExpressApplication
  }) =>
    callMutation({
      app: target,
      procedure: 'threadSandbox.provision',
      input,
      ...(token === undefined ? {} : { token }),
    })

  it('answers 401 without a session', async () => {
    expect((await provision({})).status).toBe(401)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty thread id', async () => {
    expect((await provision({ token: 'session-a', input: { threadId: '' } })).status).toBe(400)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers 400 for a missing thread id', async () => {
    expect((await provision({ token: 'session-a', input: {} })).status).toBe(400)
  })

  it("answers 404 for someone else's thread", async () => {
    expect((await provision({ token: 'session-b' })).status).toBe(404)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('provisions for the owner and answers Booting in wire shape', async () => {
    const reply = await provision({ token: 'session-a' })

    expect(reply.status).toBe(200)
    expect(sandboxProvisionReplySchema.parse(reply.body.result.data)).toEqual({
      state: ESandboxProvisionState.Booting,
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('answers the standing state on a second call without dispatching again', async () => {
    await provision({ token: 'session-a' })

    const reply = await provision({ token: 'session-a' })

    expect(reply.status).toBe(200)
    expect(reply.body.result.data).toEqual({ state: ESandboxProvisionState.Booting })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('answers 502 when dispatch fails', async () => {
    const reply = await provision({ token: 'session-a', target: failingApp })

    expect(reply.status).toBe(502)
    expect(reply.body.error.message).toBe(DISPATCH_FAILED_MESSAGE)
  })
})
