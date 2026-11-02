import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  revisionOf,
  type ClockPort,
} from '@dltech/atlas-core'
import {
  AvailabilityControl,
  EAvailabilityAuthority,
  InMemoryCredentialAvailability,
  memoryAccountStore,
} from '@dltech/atlas-harness'
import {
  ECapability,
  EClientFrame,
  EClientRequest,
  capabilitySetOf,
  EAvailabilityAction,
  EAvailabilityControlResult,
} from '@dltech/atlas-wire'

import { routeAvailabilityRequest } from '../availability-requests'
import type { ReplyFrame, RequestFrame } from '../request-reply'

const clock: ClockPort = { now: () => '2026-11-02T12:00:00.000Z' }
const capable = capabilitySetOf([ECapability.ModelAvailabilityControls])

async function open(authority: EAvailabilityAuthority) {
  const accounts = memoryAccountStore({ clock })
  const account = await accounts.add({
    provider: EAuthProvider.Anthropic,
    label: 'work',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-test' },
    origin: EAccountOrigin.Login,
  })
  const availability = new InMemoryCredentialAvailability({
    clock,
    manualPausedAt: async (id) => (await accounts.read(id))?.manuallyPausedAt ?? null,
  })
  const control = new AvailabilityControl({
    availability,
    accounts,
    localVault: accounts,
    waitState: { waiting: () => [], reconcile: async () => undefined },
    wakeChild: () => undefined,
    authorityOf: async () => authority,
  })
  const generation = revisionOf((await accounts.read(account.id))!).value
  const params = (action: EAvailabilityAction) => ({
    key: { accountId: account.id, providerId: 'anthropic', modelId: 'claude-opus-5' },
    expectedGeneration: generation,
    requestId: `req-${action}`,
    action,
  })
  return { accounts, control, account, params }
}

const frameOf = (args: { op: EClientRequest; params: unknown }): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'r1',
  op: args.op,
  params: args.params,
})

const replyTo = (args: {
  frame: RequestFrame
  control: AvailabilityControl | undefined
  capabilities?: ReturnType<typeof capabilitySetOf> | undefined
}): Promise<ReplyFrame> =>
  new Promise((resolve) => {
    const routed = routeAvailabilityRequest({
      frame: args.frame,
      availability: args.control,
      capabilities: () => args.capabilities,
      reply: resolve,
    })
    if (!routed) throw new Error('not routed')
  })

describe('serve model availability requests', () => {
  it('lets a capable client control a local account through the module', async () => {
    const { control, accounts, account, params } = await open(EAvailabilityAuthority.Local)

    const reply = await replyTo({
      frame: frameOf({
        op: EClientRequest.ControlLocalModelAvailability,
        params: params(EAvailabilityAction.Pause),
      }),
      control,
      capabilities: capable,
    })

    expect(reply.ok).toBe(true)
    expect((reply.data as { result: string }).result).toBe(EAvailabilityControlResult.Applied)
    expect((await accounts.read(account.id))?.manuallyPausedAt).not.toBeNull()
  })

  it('refuses a manual pause on a cloud-account session without touching the vault', async () => {
    const { control, accounts, account, params } = await open(EAvailabilityAuthority.Sandbox)

    const reply = await replyTo({
      frame: frameOf({
        op: EClientRequest.ControlLocalModelAvailability,
        params: params(EAvailabilityAction.Pause),
      }),
      control,
      capabilities: capable,
    })

    expect(reply.ok).toBe(false)
    expect((reply.data as { message: string }).message).toContain('Cloud')
    expect((await accounts.read(account.id))?.manuallyPausedAt).toBeUndefined()
  })

  it('refuses a client that did not advertise the capability', async () => {
    const { control, params } = await open(EAvailabilityAuthority.Local)

    const reply = await replyTo({
      frame: frameOf({
        op: EClientRequest.ControlLocalModelAvailability,
        params: params(EAvailabilityAction.Pause),
      }),
      control,
      capabilities: capabilitySetOf(undefined),
    })

    expect(reply.ok).toBe(false)
    expect((reply.data as { message: string }).message).toContain('Update/restart')
  })

  it('answers the read with the current waiting episodes', async () => {
    const { control } = await open(EAvailabilityAuthority.Local)

    const reply = await replyTo({
      frame: frameOf({ op: EClientRequest.ReadModelAvailability, params: {} }),
      control,
      capabilities: capable,
    })

    expect(reply).toMatchObject({ ok: true, data: { waiting: [] } })
  })

  it('refuses malformed control params and a serve with no control bound', async () => {
    const { control } = await open(EAvailabilityAuthority.Local)

    const malformed = await replyTo({
      frame: frameOf({ op: EClientRequest.ControlLocalModelAvailability, params: { nope: 1 } }),
      control,
      capabilities: capable,
    })
    const unbound = await replyTo({
      frame: frameOf({ op: EClientRequest.ReadModelAvailability, params: {} }),
      control: undefined,
      capabilities: capable,
    })

    expect(malformed.ok).toBe(false)
    expect(unbound.ok).toBe(false)
  })

  it('does not claim unrelated ops', () => {
    expect(
      routeAvailabilityRequest({
        frame: frameOf({ op: EClientRequest.ListRoster, params: {} }),
        availability: undefined,
        capabilities: () => capable,
        reply: () => undefined,
      }),
    ).toBe(false)
  })
})
