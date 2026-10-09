import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { GithubSubscriptionsController } from './github-subscriptions.controller'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

function controllerWith(): {
  controller: GithubSubscriptionsController
  subscribe: ReturnType<typeof vi.fn>
  heartbeat: ReturnType<typeof vi.fn>
} {
  const subscribe = vi.fn(async () => ({}))
  const heartbeat = vi.fn(async () => ({ expiresAt: '2026-10-09T00:05:00.000Z' }))
  const subscriptions = { subscribe, heartbeat } as unknown as GithubSubscriptionsService
  return { controller: new GithubSubscriptionsController(subscriptions), subscribe, heartbeat }
}

function requestFor(args: { sandbox?: { sandboxId: string; threadId: string } }): AuthenticatedRequest {
  const request = {
    auth: {
      userId: 'usr_1',
      sessionId: 'ses_1',
      email: '',
      activeOrganizationId: null,
    },
  } as AuthenticatedRequest
  if (args.sandbox !== undefined) request.sandbox = args.sandbox
  return request
}

describe('GithubSubscriptionsController sandbox link', () => {
  it('passes the sandbox principal through on subscribe', async () => {
    const { controller, subscribe } = controllerWith()

    await controller.handleSubscribe(
      requestFor({ sandbox: { sandboxId: 'sbx_1', threadId: 'thr_1' } }),
      { repoFullName: 'compai/app', prNumber: 42 },
    )

    expect(subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })
  })

  it('a user-session subscribe carries no link', async () => {
    const { controller, subscribe } = controllerWith()

    await controller.handleSubscribe(requestFor({}), { repoFullName: 'compai/app', prNumber: 42 })

    expect(subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
  })

  it('passes the sandbox principal through on heartbeat', async () => {
    const { controller, heartbeat } = controllerWith()

    await controller.handleHeartbeat(
      requestFor({ sandbox: { sandboxId: 'sbx_1', threadId: 'thr_1' } }),
      'sub_1',
    )

    expect(heartbeat).toHaveBeenCalledWith({
      userId: 'usr_1',
      subscriptionId: 'sub_1',
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })
  })

  it('a user-session heartbeat carries no link', async () => {
    const { controller, heartbeat } = controllerWith()

    await controller.handleHeartbeat(requestFor({}), 'sub_1')

    expect(heartbeat).toHaveBeenCalledWith({ userId: 'usr_1', subscriptionId: 'sub_1' })
  })
})
