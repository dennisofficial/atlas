import { describe, expect, it } from 'bun:test'

import type { CommandContext } from '@dltech/atlas-commands'
import {
  ESubscriptionActor,
  ESubscriptionStatus,
  toThreadId,
  type Event,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { setSubscriptionStatusCommand, subscriptionsOfEvents } from '../../core'
import { podCommands } from '../commands'

const rig = () => {
  const log: V2Event[] = []
  const append: CommandContext<unknown>['append'] = async (bodies) => {
    for (const body of bodies) {
      log.push({
        ...body,
        seq: log.length + 1,
        threadId: toThreadId('t1'),
        at: '2026-11-08T10:00:00.000Z',
      } as V2Event)
    }
  }
  const context = (args: unknown): CommandContext<unknown> => ({
    args,
    sessionId: 's1',
    inboxId: 1,
    visibleEvents: () => log as readonly Event[],
    append,
    log: () => undefined,
  })
  return { log, append, context }
}

const created: V2Body = {
  type: 'subscription-created',
  subscriptionId: 's1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/owner/atlas', number: 31 },
  label: 'owner/atlas#31',
  createdBy: ESubscriptionActor.Agent,
}

const handler = () => {
  const found = podCommands.get(setSubscriptionStatusCommand.inboxKind)
  if (found === undefined) throw new Error('no set-subscription-status handler')
  return found
}

describe('set-subscription-status command', () => {
  it('pauses a subscription the session holds and the fold reflects it', async () => {
    const { log, append, context } = rig()
    await append([created])
    const outcome = await handler()(
      context({ subscriptionId: 's1', status: ESubscriptionStatus.Paused }),
    )
    expect(outcome).toEqual({ kind: 'done' })
    expect(log.at(-1)).toMatchObject({
      type: 'subscription-changed',
      subscriptionId: 's1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    const [row] = subscriptionsOfEvents(log)
    expect(row?.status).toBe(ESubscriptionStatus.Paused)
    expect(row?.presentation.icon).toBe('git-pull-request')
  })

  it('resumes a paused subscription', async () => {
    const { log, append, context } = rig()
    await append([created])
    await handler()(context({ subscriptionId: 's1', status: ESubscriptionStatus.Paused }))
    expect(
      await handler()(context({ subscriptionId: 's1', status: ESubscriptionStatus.Active })),
    ).toEqual({ kind: 'done' })
    expect(subscriptionsOfEvents(log)[0]?.status).toBe(ESubscriptionStatus.Active)
  })

  it('appends nothing when the status is already the one asked for', async () => {
    const { log, append, context } = rig()
    await append([created])
    const before = log.length
    expect(
      await handler()(context({ subscriptionId: 's1', status: ESubscriptionStatus.Active })),
    ).toEqual({ kind: 'done' })
    expect(log).toHaveLength(before)
  })

  it('refuses an unknown id, naming what to run instead', async () => {
    const { log, append, context } = rig()
    await append([created])
    const outcome = await handler()(
      context({ subscriptionId: 'ghost', status: ESubscriptionStatus.Paused }),
    )
    expect(outcome).toMatchObject({ kind: 'refused' })
    expect(outcome.kind === 'refused' ? outcome.reason : '').toContain('action list')
    expect(log).toHaveLength(1)
  })
})
