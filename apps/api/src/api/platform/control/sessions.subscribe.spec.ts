import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ESubscriptionActor, ESubscriptionEnd, INBOX_KIND_RECORD } from '@dltech/atlas-core'
import { setupSessionsService as setup } from './sessions.service.fixture'

const REPO = 'github.com/acme/atlas'

const seed = async () => {
  const context = setup()
  const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
  return { ...context, sessionId: created.sessionId }
}

describe('SessionsService subscribe', () => {
  it('writes the row for the session main thread and records it', async () => {
    const { plane, service, sessionId } = await seed()

    const subscribed = await service.subscribe({
      userId: 'user-a',
      sessionId,
      provider: 'github.pull-request',
      target: 'acme/atlas#7',
    })

    expect(subscribed.existed).toBe(false)
    expect(subscribed.updated).toBe(false)
    expect(subscribed.subscription).toMatchObject({
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      createdBy: ESubscriptionActor.Operator,
    })
    const inbox = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    expect(inbox.map((entry) => entry.kind)).toEqual([INBOX_KIND_RECORD])
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toMatchObject({
      event: { type: 'subscription-created', createdBy: ESubscriptionActor.Operator },
    })
  })

  it('reads a pull request URL and a workflow run reference', async () => {
    const { service, sessionId } = await seed()

    const fromUrl = await service.subscribe({
      userId: 'user-a',
      sessionId,
      provider: 'github.pull-request',
      target: 'https://github.com/acme/atlas/pull/9',
    })
    const fromRun = await service.subscribe({
      userId: 'user-a',
      sessionId,
      provider: 'github.workflow-run',
      target: 'acme/atlas#12',
    })

    expect(fromUrl.subscription.target).toEqual({ repo: REPO, number: 9 })
    expect(fromRun.subscription).toMatchObject({
      provider: 'github.workflow-run',
      target: { kind: 'run', repo: REPO, runId: 12 },
      label: 'acme/atlas#12',
    })
  })

  it.each([
    { provider: 'github.pull-request', target: '#7' },
    { provider: 'github.pull-request', target: 'acme/atlas' },
    { provider: 'github.workflow-run', target: 'acme/atlas' },
    { provider: 'gitlab.merge-request', target: 'acme/atlas#7' },
  ])('refuses $provider $target without writing a row', async (args) => {
    const { plane, service, sessionId } = await seed()

    const refused = service.subscribe({ userId: 'user-a', sessionId, ...args })

    expect(refused).rejects.toBeInstanceOf(BadRequestException)
    await refused.catch(() => undefined)
    expect(await plane.listSubscriptions({ sessionId })).toEqual([])
  })

  it('refuses a session of another user', async () => {
    const { service, sessionId } = await seed()

    await expect(
      service.subscribe({
        userId: 'user-b',
        sessionId,
        provider: 'github.pull-request',
        target: 'acme/atlas#7',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('SessionsService unsubscribe', () => {
  it('ends the row and records the ending', async () => {
    const { plane, service, sessionId } = await seed()
    const subscribed = await service.subscribe({
      userId: 'user-a',
      sessionId,
      provider: 'github.pull-request',
      target: 'acme/atlas#7',
    })

    expect(
      await service.unsubscribe({
        userId: 'user-a',
        sessionId,
        subscriptionId: subscribed.subscription.id,
      }),
    ).toEqual({ ended: true })
    expect(await plane.listSubscriptions({ sessionId })).toEqual([])
    const inbox = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    expect(JSON.parse(inbox[1]?.payload ?? '{}')).toMatchObject({
      event: {
        type: 'subscription-ended',
        subscriptionId: subscribed.subscription.id,
        reason: ESubscriptionEnd.Unsubscribed,
        by: ESubscriptionActor.Operator,
      },
    })
  })

  it('answers ended false for an id the session never held', async () => {
    const { service, sessionId } = await seed()

    expect(
      await service.unsubscribe({ userId: 'user-a', sessionId, subscriptionId: 'missing' }),
    ).toEqual({ ended: false })
  })
})
