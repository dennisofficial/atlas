import { describe, expect, it } from 'bun:test'

import { EToolEffect, ESubscriptionActor, toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { CHILD, MAIN, registryOf } from '../../../subscriptions/__tests__/registry-fixture'
import type { SubscriptionToolDeps } from '../../../subscriptions/tool-deps'
import { SubscribeTool } from '../subscribe'
import { SubscriptionListTool } from '../subscription-list'
import { UnsubscribeTool } from '../unsubscribe'

const NOW = Date.parse('2026-10-28T12:00:00.000Z')

const toolsOf = (
  parents?: ReadonlyMap<ReturnType<typeof toThreadId>, ReturnType<typeof toThreadId>>,
) => {
  const fixture = registryOf({ parents })
  const deps: SubscriptionToolDeps = {
    registry: () => fixture.registry,
    owners: { ownerOf: async ({ threadId }) => parents?.get(threadId) ?? threadId },
    now: () => NOW,
  }
  return {
    fixture,
    subscribe: new SubscribeTool(deps),
    unsubscribe: new UnsubscribeTool(deps),
    list: new SubscriptionListTool(deps),
  }
}

const call = (
  tool: SubscribeTool | UnsubscribeTool | SubscriptionListTool,
  input: unknown,
  threadId = MAIN,
): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key',
    projectDirectory: '/repo',
    threadId,
  } as Parameters<typeof tool.invoke>[0])

const textOf = (outcome: ToolOutcome): string => {
  if (!outcome.ok) return outcome.reason
  return outcome.modelText
}

describe('subscribe', () => {
  it('declares itself a write', () => {
    expect(toolsOf().subscribe.effect).toBe(EToolEffect.Write)
  })

  it('subscribes, naming the id, label and expiry, and records it as agent-created', async () => {
    const { subscribe, fixture } = toolsOf()
    const outcome = await call(subscribe, {
      provider: 'fake.pr',
      target: 'a/b#1',
      expiresInMinutes: 30,
    })

    expect(outcome.ok).toBe(true)
    const text = textOf(outcome)
    expect(text).toContain('Subscribed to fake a/b#1')
    expect(text).toContain('sub-1')
    expect(text).toContain(new Date(NOW + 30 * 60_000).toISOString())
    expect(fixture.log.ofType('subscription-created')).toMatchObject([
      { createdBy: ESubscriptionActor.Agent, expiresAt: new Date(NOW + 30 * 60_000).toISOString() },
    ])
  })

  it('says when the subscription already existed', async () => {
    const { subscribe } = toolsOf()
    await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' })
    const again = await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' })
    expect(textOf(again)).toContain('Already subscribed')
    expect(textOf(again)).toContain('no expiry')
  })

  it('fails with the registry’s error for an unknown provider', async () => {
    const outcome = await call(toolsOf().subscribe, { provider: 'nope' })
    expect(outcome).toEqual({
      ok: false,
      reason: 'Unknown subscription provider "nope". Available: fake.pr.',
    })
  })

  it('rejects input that does not match the schema', async () => {
    const outcome = await call(toolsOf().subscribe, { target: 'a/b#1' })
    expect(outcome.ok).toBe(false)
  })
})

describe('subscription_list', () => {
  it('declares itself a read', () => {
    expect(toolsOf().list.effect).toBe(EToolEffect.Read)
  })

  it('lists no subscriptions and the available providers', async () => {
    const outcome = await call(toolsOf().list, {})
    const text = textOf(outcome)
    expect(text).toContain('This conversation has no subscriptions.')
    expect(text).toContain('fake.pr  A fake pull request  target: owner/repo#number')
  })

  it('lists the caller’s subscriptions with status, creator, expiry and held count', async () => {
    const { subscribe, list } = toolsOf()
    await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' })
    const outcome = await call(list, {})
    expect(textOf(outcome)).toContain(
      'sub-1  fake.pr  fake a/b#1  active  by agent  no expiry  0 held',
    )
  })

  it('shows a subagent its parent’s subscriptions and nobody else’s', async () => {
    const parents = new Map([[CHILD, MAIN]])
    const { subscribe, list } = toolsOf(parents)
    await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' }, MAIN)
    expect(textOf(await call(list, {}, CHILD))).toContain('sub-1')
    expect(textOf(await call(list, {}, toThreadId('stranger')))).toContain('no subscriptions')
  })
})

describe('unsubscribe', () => {
  it('declares itself a write', () => {
    expect(toolsOf().unsubscribe.effect).toBe(EToolEffect.Write)
  })

  it('ends an owned subscription', async () => {
    const { subscribe, unsubscribe, fixture } = toolsOf()
    await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' })
    const outcome = await call(unsubscribe, { subscriptionId: 'sub-1' })
    expect(textOf(outcome)).toContain('Unsubscribed from fake a/b#1')
    expect(fixture.registry.list()).toEqual([])
    expect(fixture.log.ofType('subscription-ended')).toMatchObject([
      { reason: 'unsubscribed', by: 'agent' },
    ])
  })

  it('refuses a subscription another thread owns', async () => {
    const { subscribe, unsubscribe, fixture } = toolsOf()
    await call(subscribe, { provider: 'fake.pr', target: 'a/b#1' }, MAIN)
    const outcome = await call(unsubscribe, { subscriptionId: 'sub-1' }, toThreadId('stranger'))
    expect(outcome.ok).toBe(false)
    expect(fixture.registry.list()).toHaveLength(1)
  })

  it('refuses an unknown id', async () => {
    const outcome = await call(toolsOf().unsubscribe, { subscriptionId: 'ghost' })
    expect(textOf(outcome)).toContain('no subscription "ghost"')
  })
})
