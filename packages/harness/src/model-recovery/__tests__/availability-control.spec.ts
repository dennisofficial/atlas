import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAdmissionCompletion,
  EAuthKind,
  EAuthProvider,
  EAvailabilityControl,
  EAvailabilityControlResult,
  ECredentialAvailability,
  EModelWaitCause,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  EWaitEpisodeKind,
  revisionOf,
  toThreadId,
  type AccountId,
  type AvailabilityKey,
  type ClockPort,
  type CredentialAvailabilityPort,
  type NormalizedProviderFailure,
  type ThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { InMemoryCredentialAvailability } from '../../credentials/credential-availability'
import { memoryAccountStore } from '../../credentials/account-store'
import {
  AvailabilityControl,
  AvailabilityControlRefusedError,
  EAvailabilityAction,
  EAvailabilityAuthority,
} from '../availability-control'

const clock: ClockPort = { now: () => '2026-11-02T12:00:00.000Z' }
const root = toThreadId('root')
const child = toThreadId('child')

const quota: NormalizedProviderFailure = {
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'allowance exhausted',
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
}

const waitingOn = (args: { key: AvailabilityKey; threads: ThreadId[] }): WaitingForModel => ({
  episode: { kind: EWaitEpisodeKind.Credential, key: args.key, generation: 0 },
  cause: EModelWaitCause.Availability,
  providerId: args.key.providerId,
  accountId: args.key.accountId,
  modelId: args.key.modelId,
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: args.threads,
})

async function open(args?: { authority?: EAvailabilityAuthority }) {
  const accounts = memoryAccountStore({ clock })
  const account = await accounts.add({
    provider: EAuthProvider.Anthropic,
    label: 'work',
    secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-test' },
    origin: EAccountOrigin.Login,
  })
  const key: AvailabilityKey = {
    accountId: account.id,
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
  }
  const authority = new InMemoryCredentialAvailability({
    clock,
    manualPausedAt: async (id: AccountId) => (await accounts.read(id))?.manuallyPausedAt ?? null,
  })
  const revision = revisionOf((await accounts.read(account.id))!)
  const episodes: WaitingForModel[] = []
  const cleared: WaitingForModel[] = []
  const controls: EAvailabilityControl[] = []
  const woken: ThreadId[] = []
  const rootWoken: ThreadId[] = []
  const port: Pick<CredentialAvailabilityPort, 'inspect' | 'control'> = {
    inspect: (input) => authority.inspect(input),
    control: (input) => {
      controls.push(input.action)
      return authority.control(input)
    },
  }
  const control = new AvailabilityControl({
    availability: port,
    accounts,
    localVault: accounts,
    waitState: {
      waiting: () => episodes.filter((one) => !cleared.includes(one)),
      reconcile: async ({ eligible }) => {
        for (const one of episodes) if (await eligible(one)) cleared.push(one)
      },
    },
    wakeChild: ({ threadId }) => {
      if (threadId !== child) return undefined
      woken.push(threadId)
      return Promise.resolve()
    },
    authorityOf: async () => args?.authority ?? EAvailabilityAuthority.Local,
    probeOutstanding: (input) => authority.probeOutstanding(input),
  })
  control.bindRootWake(({ threadId }) => rootWoken.push(threadId))
  const block = async (): Promise<void> => {
    const decision = await authority.admit({ key, revision })
    if (!decision.admitted) throw new Error('unexpected block')
    await authority.complete({
      permit: decision.permit,
      completion: { outcome: EAdmissionCompletion.Failed, failure: quota },
    })
  }
  const request = (action: EAvailabilityAction, requestId = `req-${action}`) => ({
    key,
    expectedGeneration: revision.value,
    requestId,
    action,
  })
  return {
    accounts,
    authority,
    control,
    key,
    revision,
    episodes,
    cleared,
    controls,
    woken,
    rootWoken,
    block,
    request,
  }
}

describe('operator availability control', () => {
  it('pauses locally through the vault overlay, which the authority reads before admission', async () => {
    const test = await open()

    const outcome = await test.control.control(test.request(EAvailabilityAction.Pause))

    expect(outcome.result).toBe(EAvailabilityControlResult.Applied)
    expect(outcome.snapshot.availability).toBe(ECredentialAvailability.Paused)
    expect((await test.accounts.read(test.key.accountId))?.manuallyPausedAt).not.toBeNull()
    const decision = await test.authority.admit({ key: test.key, revision: test.revision })
    expect(decision.admitted).toBe(false)
  })

  it('removes only the manual pause: a quota barrier stays and nothing wakes', async () => {
    const test = await open()
    await test.block()
    test.episodes.push(waitingOn({ key: test.key, threads: [root] }))
    await test.control.control(test.request(EAvailabilityAction.Pause))

    const outcome = await test.control.control(test.request(EAvailabilityAction.RemoveManualPause))

    expect((await test.accounts.read(test.key.accountId))?.manuallyPausedAt).toBeNull()
    expect(outcome.result).toBe(EAvailabilityControlResult.Unavailable)
    expect(test.cleared).toEqual([])
    expect(test.rootWoken).toEqual([])
  })

  it('resumes and wakes the waiting threads once removing the pause leaves nothing closed', async () => {
    const test = await open()
    test.episodes.push(waitingOn({ key: test.key, threads: [root, child] }))
    await test.control.control(test.request(EAvailabilityAction.Pause))

    const outcome = await test.control.control(test.request(EAvailabilityAction.RemoveManualPause))

    expect(outcome.result).toBe(EAvailabilityControlResult.Available)
    expect(test.cleared).toHaveLength(1)
    expect(test.rootWoken).toEqual([root])
    expect(test.woken).toEqual([child])
  })

  it('rechecks without mutating the authority, clearing the episode and waking each thread once', async () => {
    const test = await open()
    await test.block()
    test.episodes.push(waitingOn({ key: test.key, threads: [root, child] }))

    const outcome = await test.control.control(test.request(EAvailabilityAction.Recheck))

    expect(outcome.result).toBe(EAvailabilityControlResult.Applied)
    expect(outcome.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
    expect(test.controls).toEqual([])
    expect(test.rootWoken).toEqual([root])
    expect(test.woken).toEqual([child])
  })

  it('arms one probe: the next admission is the probe and a second is held back', async () => {
    const test = await open()
    await test.block()
    await test.control.control(test.request(EAvailabilityAction.Recheck))

    const probe = await test.authority.admit({ key: test.key, revision: test.revision })
    const second = await test.authority.admit({ key: test.key, revision: test.revision })

    expect(probe.admitted && probe.permit.probe).toBe(true)
    expect(second.admitted).toBe(false)
  })

  it('answers ProbeInProgress and wakes nobody while a probe lease is outstanding', async () => {
    const test = await open()
    await test.block()
    test.episodes.push(waitingOn({ key: test.key, threads: [root, child] }))
    const probe = await test.authority.admit({ key: test.key, revision: test.revision })
    expect(probe.admitted && probe.permit.probe).toBe(true)

    const outcome = await test.control.control(test.request(EAvailabilityAction.Recheck))

    expect(outcome.result).toBe(EAvailabilityControlResult.ProbeInProgress)
    expect(outcome.snapshot.availability).toBe(ECredentialAvailability.QuotaExhausted)
    expect(test.cleared).toEqual([])
    expect(test.rootWoken).toEqual([])
    expect(test.woken).toEqual([])
  })

  it('rechecks normally again once the probe settles', async () => {
    const test = await open()
    await test.block()
    test.episodes.push(waitingOn({ key: test.key, threads: [root] }))
    const probe = await test.authority.admit({ key: test.key, revision: test.revision })
    if (!probe.admitted) throw new Error('expected the probe')
    await test.authority.complete({
      permit: probe.permit,
      completion: { outcome: EAdmissionCompletion.Cancelled },
    })

    const outcome = await test.control.control(test.request(EAvailabilityAction.Recheck))

    expect(outcome.result).toBe(EAvailabilityControlResult.Applied)
    expect(test.rootWoken).toEqual([root])
  })

  it('cannot dispatch or clear a pause when rechecking while paused', async () => {
    const test = await open()
    test.episodes.push(waitingOn({ key: test.key, threads: [root] }))
    await test.control.control(test.request(EAvailabilityAction.Pause))

    const outcome = await test.control.control(test.request(EAvailabilityAction.Recheck))

    expect(outcome.result).toBe(EAvailabilityControlResult.Unavailable)
    expect(test.cleared).toEqual([])
    expect(test.rootWoken).toEqual([])
    expect((await test.accounts.read(test.key.accountId))?.manuallyPausedAt).not.toBeNull()
  })

  it('answers Stale when the credential revision moved, changing nothing', async () => {
    const test = await open()
    await test.accounts.replaceSecret({
      accountId: test.key.accountId,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-rotated' },
    })

    const outcome = await test.control.control(test.request(EAvailabilityAction.Pause))

    expect(outcome.result).toBe(EAvailabilityControlResult.Stale)
    expect((await test.accounts.read(test.key.accountId))?.manuallyPausedAt).toBeUndefined()
  })

  it('applies a repeated requestId once', async () => {
    const test = await open()

    const first = await test.control.control(test.request(EAvailabilityAction.Pause, 'same'))
    const second = await test.control.control(test.request(EAvailabilityAction.Pause, 'same'))

    expect(second).toBe(first)
    expect((await test.accounts.read(test.key.accountId))?.availabilityControlGeneration).toBe(1)
  })

  it('refuses a manual pause on a sandbox-held account but still rechecks it', async () => {
    const test = await open({ authority: EAvailabilityAuthority.Sandbox })

    const refused = await test.control
      .control(test.request(EAvailabilityAction.Pause))
      .catch((error: unknown) => error)
    const rechecked = await test.control.control(test.request(EAvailabilityAction.Recheck))

    expect(refused).toBeInstanceOf(AvailabilityControlRefusedError)
    expect(rechecked.result).toBe(EAvailabilityControlResult.Available)
  })

  it('delegates a Cloud account pause to the authority and never the local vault', async () => {
    const test = await open({ authority: EAvailabilityAuthority.Cloud })

    const outcome = await test.control.control(test.request(EAvailabilityAction.Pause))

    expect(test.controls).toEqual([EAvailabilityControl.Pause])
    expect(outcome.snapshot.availability).toBe(ECredentialAvailability.Paused)
    expect((await test.accounts.read(test.key.accountId))?.manuallyPausedAt).toBeUndefined()
  })
})
